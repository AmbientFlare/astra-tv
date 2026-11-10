#!/usr/bin/env python3
"""On-stick playback tests. See README.md in this directory.

The steps run in order on one stick and share its state: each one starts
where the last one left the app. The run stops at the first failure, because
every later step would be starting from the wrong screen.
"""

import argparse
import os
import re
import shlex
import subprocess
import sys
import time
from typing import Callable, Dict, List, Optional, Tuple

from stick import Stats, Stick, StickError

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# Remote presses that take a freshly started app from Home to the detail page
# of something playable. The default suits the lab server: down to the Movies
# row, second library, first title.
DEFAULT_ITEM_PATH = 'DOWN,RIGHT,ENTER,ENTER'


# Long enough for the system to suspend JS and look for a held decoder.
BACKGROUND_HOLD_SECONDS = 20
# Far enough into a two-hour film for the server to keep a resume point.
RESUME_MIN_SECONDS = 480


# How long a pause must last before the server's sweep, run with a one-minute
# limit, counts the session as idle.
SWEEP_IDLE_SECONDS = 80


class Failed(Exception):
    pass


class Skipped(Exception):
    pass


class Server:
    """The media server's transcode folder, read over ssh.

    Only the steps that check what the server keeps on disk need it, and
    they are skipped when it is not configured.
    """

    def __init__(self) -> None:
        self.host = os.environ.get('ASTRA_STICK_SERVER')
        self.folder = os.environ.get('ASTRA_STICK_TRANSCODES')
        self.sweep_command = os.environ.get('ASTRA_STICK_SWEEP')

    def require(self, sweep: bool = False) -> None:
        if not self.host or not self.folder:
            raise Skipped('set ASTRA_STICK_SERVER and ASTRA_STICK_TRANSCODES')
        if sweep and not self.sweep_command:
            raise Skipped('set ASTRA_STICK_SWEEP')

    def run(self, command: str) -> str:
        result = subprocess.run(
            ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
             str(self.host), command],
            capture_output=True, text=True, timeout=90, check=False,
        )
        if result.returncode != 0:
            raise Failed(
                'Could not run a command on the server: '
                + (result.stderr.strip() or 'exit %d' % result.returncode)
            )
        return result.stdout

    def sessions(self) -> Dict[str, int]:
        """Files held per transcode session, keyed by the session's prefix."""
        counts: Dict[str, int] = {}
        listing = self.run('ls -- %s' % shlex.quote(str(self.folder)))
        for name in listing.split():
            if re.match(r'[0-9a-f]{32}', name):
                counts[name[:32]] = counts.get(name[:32], 0) + 1
        return counts

    def sweep(self) -> None:
        self.run(str(self.sweep_command))


def expected_build() -> str:
    with open(os.path.join(REPO, 'src', 'config', 'app.ts')) as source:
        match = re.search(r"BUILD_NUMBER = '([^']+)'", source.read())
    if not match:
        raise Failed('Could not read BUILD_NUMBER from src/config/app.ts')
    return match.group(1)


class Session:
    def __init__(self, stick: Stick, item_path: List[str]):
        self.stick = stick
        self.item_path = item_path
        # The process the run started with. A different one later means the
        # app crashed or was ended and came back, whatever the screen shows.
        self.pid: Optional[int] = None
        self.server = Server()

    def expect_same_process(self, state: str = 'VISIBLE') -> None:
        pid, now = self.stick.process()
        if pid is None:
            raise Failed('Astra is no longer running.')
        if pid != self.pid:
            raise Failed(
                'Astra restarted: process %s became %s.' % (self.pid, pid)
            )
        if now != state:
            raise Failed('Astra is %s, expected %s.' % (now, state))

    # -- helpers -----------------------------------------------------------

    def read(self, name: str, tries: int = 4) -> Stats:
        """Reads the stats panel, allowing for a frame the OCR cannot read."""
        stats = self.stick.stats(name)
        for _ in range(tries - 1):
            if stats.position is not None:
                break
            time.sleep(1)
            stats = self.stick.stats(name)
        return stats

    def position(self, name: str) -> int:
        stats = self.read(name)
        if stats.black:
            raise Failed('The screen is completely black.')
        if stats.position is None:
            raise Failed(
                'No position on screen. Is Settings > Stats for Nerds on, '
                'and is the player showing?'
            )
        if not stats.no_failure:
            raise Failed('The player recorded a failure:\n' + stats.text)
        return stats.position

    def expect_advancing(self, name: str, timeout: float = 45) -> int:
        deadline = time.time() + timeout
        last: Optional[int] = None
        while time.time() < deadline:
            stats = self.read(name, tries=1)
            if stats.position is not None:
                if last is not None and stats.position > last:
                    if not stats.no_failure:
                        raise Failed('The player recorded a failure:\n' + stats.text)
                    return stats.position
                last = stats.position
            time.sleep(2)
        raise Failed('Playback is not advancing (last position: %s).' % last)

    def expect_text(self, name: str, wanted: str, timeout: float = 30) -> str:
        text = self.stick.wait_for_text(name, wanted, timeout)
        if text is None:
            raise Failed('Expected "%s" on screen.' % wanted)
        return text

    def open_exit_prompt(self) -> None:
        # Back hides the controls first if they are up, then asks. A third
        # press would dismiss the prompt again, so look after each one.
        for attempt in range(3):
            self.stick.press('BACK')
            time.sleep(1)
            if self.stick.wait_for_text('exit-prompt', 'Stop Playback', 2):
                return
        raise Failed('Back did not bring up the Stop Playback prompt.')

    def leave_player(self) -> None:
        """Stops playback the way a viewer would, if the player is up.

        Ending the app instead never tells the server to stop, and its
        transcode keeps running there.
        """
        for attempt in range(3):
            text = self.stick.screen_text('cleanup')
            if 'Stop Playback' in text:
                self.stick.press('RIGHT', 'ENTER')
                return
            # The stats panel is only drawn over the player. A player that
            # never started closes on the first Back, without asking.
            if 'Stats for Nerds' not in text:
                return
            self.stick.press('BACK')
            time.sleep(1)

    def play_from_detail(self, name: str) -> None:
        if 'Play from Start' in self.stick.screen_text(name + '-buttons'):
            self.stick.press('RIGHT', 'ENTER')
        else:
            self.stick.press('ENTER')
        self.expect_advancing(name)

    def finished_transcode(self, before: Dict[str, int]) -> Tuple[str, int]:
        """Waits for the server to finish transcoding what is playing.

        Returns the session's prefix and how many files it holds. A server
        that throttles never finishes early; these steps are about one that
        does not.
        """
        deadline = time.time() + 420
        last: Tuple[str, int] = ('', 0)
        while time.time() < deadline:
            new = {
                prefix: count
                for prefix, count in self.server.sessions().items()
                if prefix not in before
            }
            if new:
                current = max(new.items(), key=lambda item: item[1])
                if current == last:
                    return current
                last = current
            time.sleep(15)
        if not last[1]:
            raise Skipped('this title is not transcoded on the server')
        raise Skipped('the server did not finish the transcode in 7 minutes')

    # -- steps -------------------------------------------------------------

    def launch(self) -> None:
        stick = self.stick
        stick.press('BACK')  # Wakes the stick from its screensaver.
        if stick.process()[1] == 'VISIBLE':
            # Ending Astra mid-film leaves the server transcoding the rest
            # of it into its cache, about 10 GB a time on the lab server.
            self.leave_player()
        stick.terminate()
        time.sleep(1)
        stick.launch()
        time.sleep(6)
        if "what's new" in stick.screen_text('launch').lower():
            stick.press('ENTER')
        text = self.expect_text('home', 'Settings', 30)
        if 'Search' not in text:
            raise Failed('Home did not render its top bar.')
        self.pid, state = self.stick.process()
        if self.pid is None or state != 'VISIBLE':
            raise Failed('Astra is not in the foreground after launch.')

    def open_item(self) -> None:
        self.stick.press(*self.item_path, gap=2.5)
        self.expect_text('detail', 'Favorite', 20)

    def start(self) -> None:
        # A title with saved progress offers Resume first and Play from
        # Start second; one without has a single Play button.
        if 'Play from Start' in self.stick.screen_text('detail-buttons'):
            self.stick.press('RIGHT', 'ENTER')
        else:
            self.stick.press('ENTER')
        position = self.expect_advancing('start')
        if position > 60:
            raise Failed('Started at %d s, not at the beginning.' % position)
        stats = self.read('start-build')
        wanted = expected_build()
        if stats.build != wanted:
            raise Failed(
                'The stick is running build %s, not %s from this checkout. '
                'Install the current package first (--install).'
                % (stats.build, wanted)
            )

    def pause_and_resume(self) -> None:
        self.stick.press('PLAYPAUSE')
        time.sleep(2)
        first = self.position('paused-1')
        time.sleep(4)
        second = self.position('paused-2')
        if abs(second - first) > 1:
            raise Failed('Paused, but moved from %d s to %d s.' % (first, second))
        self.stick.press('PLAYPAUSE')
        self.expect_advancing('resumed')

    def seek_forward(self) -> None:
        before = self.position('seek-fwd-before')
        # No OK afterwards: the seek commits itself, and OK would then pause.
        self.stick.press('RIGHT', 'RIGHT', 'RIGHT')
        after = self.expect_advancing('seek-fwd-after')
        if after < before + 20:
            raise Failed(
                'Three steps forward went from %d s to only %d s.'
                % (before, after)
            )

    def seek_back(self) -> None:
        before = self.position('seek-back-before')
        self.stick.press('LEFT', 'LEFT', 'LEFT')
        after = self.expect_advancing('seek-back-after')
        if after >= before:
            raise Failed(
                'Three steps back went from %d s to %d s.' % (before, after)
            )

    def options_panel(self) -> None:
        self.stick.press('MENU')
        text = self.expect_text('options', 'Playback Options', 8)
        for label in ('Audio', 'Subtitles', 'Sleep timer'):
            if label not in text:
                raise Failed('The options panel is missing "%s".' % label)
        self.stick.press('BACK')
        time.sleep(1)
        if self.stick.wait_for_text('options-closed', 'Playback Options', 0):
            raise Failed('Back did not close the options panel.')
        self.expect_advancing('options-after')

    def exit_stay(self) -> None:
        self.open_exit_prompt()
        self.stick.press('ENTER')  # Stay has focus.
        self.expect_advancing('stayed')

    def exit_leave(self) -> None:
        self.open_exit_prompt()
        self.stick.press('RIGHT', 'ENTER')
        self.expect_text('left', 'Favorite', 15)

    def play_again(self) -> None:
        # A second session right after the first was torn down.
        self.stick.press('ENTER')
        self.expect_advancing('again')

    def resume(self) -> None:
        # The server keeps a resume point only past the first few percent of
        # a title, so go well in before leaving.
        saved = 0
        for attempt in range(6):
            self.stick.press_burst('RIGHT', 12)
            saved = self.expect_advancing('resume-far')
            if saved >= RESUME_MIN_SECONDS:
                break
        else:
            raise Failed('Could not seek far enough in (reached %d s).' % saved)
        self.open_exit_prompt()
        self.stick.press('RIGHT', 'ENTER')
        self.expect_text('resume-detail', 'Resume', 15)
        self.stick.press('ENTER')
        resumed = self.expect_advancing('resumed-at')
        # It may back up a little to a keyframe, and a few seconds pass
        # between the two readings.
        if not saved - 30 <= resumed <= saved + 90:
            raise Failed(
                'Left at %d s but Resume started at %d s.' % (saved, resumed)
            )

    def background(self) -> None:
        # Vega ends an app that still holds a decoder in the background, so
        # the same process still being there afterwards is the test of the
        # release path.
        self.stick.send_home()
        deadline = time.time() + 10
        while self.stick.process()[1] != 'NOT_VISIBLE':
            if time.time() > deadline:
                raise Failed('Home did not send Astra to the background.')
            time.sleep(1)
        time.sleep(BACKGROUND_HOLD_SECONDS)
        self.expect_same_process('NOT_VISIBLE')
        self.stick.bring_forward()
        # The player gives way to the page it was opened from.
        self.expect_text('foreground', 'Favorite', 20)
        self.expect_same_process()
        self.stick.press('ENTER')
        self.expect_advancing('after-background')
        self.open_exit_prompt()
        self.stick.press('RIGHT', 'ENTER')
        self.expect_text('end', 'Favorite', 15)


    def force_close(self) -> None:
        # An app ended mid-film never tells the server it stopped, and the
        # server keeps the whole transcode. The next launch has to say so.
        self.server.require()
        before = self.server.sessions()
        self.play_from_detail('force-close')
        prefix, files = self.finished_transcode(before)
        self.stick.terminate()
        time.sleep(20)
        if not self.server.sessions().get(prefix):
            raise Skipped('the server removed the transcode by itself')
        self.stick.launch()
        time.sleep(6)
        self.expect_text('relaunch', 'Settings', 30)
        self.pid, state = self.stick.process()
        if self.pid is None or state != 'VISIBLE':
            raise Failed('Astra is not in the foreground after relaunch.')
        deadline = time.time() + 45
        while self.server.sessions().get(prefix):
            if time.time() > deadline:
                raise Failed(
                    'The server still holds the %d files of the session '
                    'that was cut off.' % files
                )
            time.sleep(5)

    def sweep(self) -> None:
        # The server deletes transcodes nobody has read for a while. A
        # viewer who comes back to a paused film after that must still be
        # able to carry on.
        self.server.require(sweep=True)
        # The step before leaves Astra on Home, unless it was skipped.
        if 'Favorite' not in self.stick.screen_text('sweep-where'):
            self.stick.press(*self.item_path, gap=2.5)
            self.expect_text('sweep-detail', 'Favorite', 20)
        before = self.server.sessions()
        self.play_from_detail('sweep')
        prefix, files = self.finished_transcode(before)
        self.stick.press('PLAYPAUSE')
        time.sleep(2)
        paused = self.position('sweep-paused')
        time.sleep(SWEEP_IDLE_SECONDS)
        self.server.sweep()
        if self.server.sessions().get(prefix):
            raise Skipped('the sweep left the paused session in place')
        self.stick.press('PLAYPAUSE')
        # Well past what the player had buffered when it was paused.
        deadline = time.time() + 120
        reached = paused
        while reached < paused + 45:
            if time.time() > deadline:
                raise Failed(
                    'Paused at %d s; after the sweep playback only reached '
                    '%d s.' % (paused, reached)
                )
            time.sleep(5)
            stats = self.read('sweep-after', tries=1)
            if stats.position is not None:
                if not stats.no_failure:
                    raise Failed('The player recorded a failure:\n' + stats.text)
                reached = stats.position
        self.open_exit_prompt()
        self.stick.press('RIGHT', 'ENTER')
        self.expect_text('sweep-end', 'Favorite', 15)


STEPS: List[Tuple[str, str]] = [
    ('launch', 'Cold start reaches Home'),
    ('open_item', 'Home to a detail page'),
    ('start', 'Playback starts and advances, on this build'),
    ('pause_and_resume', 'Pause holds the position; resume moves on'),
    ('seek_forward', 'Seek forward lands ahead and keeps playing'),
    ('seek_back', 'Seek back lands behind and keeps playing'),
    ('options_panel', 'Menu opens Playback Options; Back closes it'),
    ('exit_stay', 'Back asks before stopping; Stay keeps playing'),
    ('exit_leave', 'Leave returns to the detail page'),
    ('play_again', 'A second session starts after the first'),
    ('resume', 'Leaving mid-film offers Resume, and it picks up there'),
    ('background', 'Home during playback: Astra survives and plays again'),
    ('force_close', 'Ended mid-film: the next launch frees the transcode'),
    ('sweep', 'Playback carries on after the server sweeps a paused film'),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--install', metavar='VPKG', help='install this package first')
    parser.add_argument('--list', action='store_true', help='list the steps and exit')
    args = parser.parse_args()
    if args.list:
        for name, title in STEPS:
            print('%-18s %s' % (name, title))
        return 0

    out_dir = os.path.join(
        REPO, 'tmp', 'stick-test', time.strftime('%Y%m%d-%H%M%S')
    )
    try:
        stick = Stick(os.environ.get('ASTRA_STICK'), out_dir)
        if args.install:
            print('Installing %s' % args.install)
            stick.install(args.install)
    except StickError as error:
        print(error, file=sys.stderr)
        return 2
    item_path = os.environ.get('ASTRA_STICK_ITEM_PATH', DEFAULT_ITEM_PATH)
    session = Session(stick, [key.strip() for key in item_path.split(',')])

    print('Stick %s, build %s' % (stick.serial, expected_build()))
    print('Screenshots: %s\n' % out_dir)
    stick.start_log()
    try:
        return run_steps(stick, session)
    finally:
        try:
            log = stick.stop_log()
        except (StickError, OSError, subprocess.SubprocessError):
            log = None
        if log:
            print('Stick log: %s' % log)
            standby = stick.standby_time(log)
            if standby:
                print(
                    'The TV told the stick to sleep at %s (stick time). The '
                    'stick ends every app when that happens, so a failure '
                    'after it is not Astra\'s. Keep the TV on and run again.'
                    % standby
                )


def run_steps(stick: Stick, session: Session) -> int:
    skipped_steps = 0
    for index, (name, title) in enumerate(STEPS):
        step: Callable[[], None] = getattr(session, name)
        started = time.time()
        try:
            step()
            session.expect_same_process()
        except Skipped as reason:
            skipped_steps += 1
            print('skip  %s (%s)' % (title, reason))
            try:
                session.leave_player()
            except (Failed, StickError):
                pass
            continue
        except (Failed, StickError) as error:
            print('FAIL  %s' % title)
            print('      %s' % str(error).replace('\n', '\n      '))
            try:
                stick.shot('FAILED-' + name)
                session.leave_player()
            except (Failed, StickError):
                pass
            print(
                '\n%d passed, 1 failed, %d skipped, %d not run.'
                % (index - skipped_steps, skipped_steps,
                   len(STEPS) - index - 1)
            )
            return 1
        print('ok    %s (%.0f s)' % (title, time.time() - started))
    if skipped_steps:
        print(
            '\n%d steps passed, %d skipped.'
            % (len(STEPS) - skipped_steps, skipped_steps)
        )
    else:
        print('\nAll %d steps passed.' % len(STEPS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
