"""Drives a Vega stick for the on-device tests.

Everything goes through the Vega CLI: remote presses with `inputd-cli`,
screenshots with `gwsi-tool-screenshooter`. JS console output never reaches a
log the CLI can fetch, so the only way to see what the player thinks is to
read the screen. The player's Stats for Nerds panel is the source of truth
here: it is cropped out of each screenshot and read with tesseract.
"""

import os
import re
import subprocess
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

from PIL import Image, ImageOps

APP = 'com.astra.tv.main'
PACKAGE = 'com.astra.tv'
DEVICE_SHOT = '/tmp/astra-stick-test.png'
DEVICE_LOG = '/tmp/astra-stick-test.log'

# Where the Stats for Nerds panel sits, as fractions of the screen, and the
# Position line inside it.
STATS_BOX = (0.635, 0.025, 0.985, 0.57)
POSITION_BOX = (0.645, 0.118, 0.80, 0.145)


class StickError(Exception):
    pass


def _run(args: List[str], timeout: int = 60) -> str:
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired:
        # A stick that has gone to sleep accepts a command and never answers.
        raise StickError(
            'The stick did not answer within %d s: %s' % (timeout, args[-1])
        )
    return (result.stdout or '') + (result.stderr or '')


def _ocr(image: Image.Image, psm: int = 6) -> str:
    path = '/tmp/astra-stick-ocr-%d.png' % os.getpid()
    image.save(path)
    try:
        return subprocess.run(
            ['tesseract', path, '-', '--psm', str(psm)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        ).stdout
    finally:
        os.remove(path)


@dataclass
class Stats:
    """What the Stats for Nerds panel said in one screenshot."""

    text: str
    # The Position line read a second time on its own.
    position_line: str = ''
    # Nothing at all was drawn: no video and no interface.
    black: bool = False

    @property
    def visible(self) -> bool:
        return 'Position' in self.text

    @staticmethod
    def _seconds(text: str) -> Optional[int]:
        match = re.search(r'Position\s+(?:(\d+):)?(\d+):(\d\d)', text)
        if not match:
            return None
        hours, minutes, seconds = match.groups()
        return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)

    @property
    def position(self) -> Optional[int]:
        """Seconds, or None when the two readings of the line disagree.

        OCR now and then mistakes one digit for another, and a wrong position
        would pass or fail a step for no reason, so a reading counts only when
        the whole panel and the line on its own say the same thing.
        """
        whole = self._seconds(self.text)
        alone = self._seconds(self.position_line)
        return whole if whole is not None and whole == alone else None

    @property
    def build(self) -> Optional[str]:
        # OCR sometimes puts a space either side of the dot.
        match = re.search(r'\((\d{8})\s*\.\s*(\d{2})\)', self.text)
        return '%s.%s' % match.groups() if match else None

    @property
    def no_failure(self) -> bool:
        return 'No recorded failure' in self.text


class Stick:
    def __init__(self, serial: Optional[str], out_dir: str):
        self.serial = serial or self._only_device()
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self._shots = 0
        self._log: Optional[subprocess.Popen] = None

    @staticmethod
    def _only_device() -> str:
        # `vega device list` shows Vega devices only; `vda devices` would also
        # count any Android emulator running on this machine.
        serials = re.findall(
            r'^(\S+) : \S+$', _run(['vega', 'device', 'list']), re.M
        )
        if len(serials) != 1:
            raise StickError(
                'Expected one connected stick, found %d. Set ASTRA_STICK to '
                'the serial to use.' % len(serials)
            )
        return serials[0]

    def cmd(self, command: str, timeout: int = 60) -> str:
        return _run(
            ['vega', 'device', 'run-cmd', '-d', self.serial, '-c', command],
            timeout,
        )

    def vega(self, *args: str, timeout: int = 120) -> str:
        return _run(['vega', 'device', *args, '-d', self.serial], timeout)

    # -- remote ------------------------------------------------------------

    def press(self, *keys: str, gap: float = 0.6) -> None:
        """Presses remote keys by evdev name without the KEY_ prefix."""
        for key in keys:
            self.cmd('inputd-cli button_press KEY_' + key.upper())
            time.sleep(gap)

    def press_burst(self, key: str, count: int) -> None:
        """Presses one key many times with no pause, as a held button does."""
        press = 'inputd-cli button_press KEY_' + key.upper()
        self.cmd('; '.join([press] * count))

    # -- app ---------------------------------------------------------------

    def process(self) -> Tuple[Optional[int], Optional[str]]:
        """Astra's pid and lifecycle state (VISIBLE, NOT_VISIBLE, ...).

        Both are None when the system has no instance of the app.
        """
        for line in self.cmd('vlcm list').splitlines():
            fields = line.split()
            if len(fields) >= 5 and fields[0] == APP and fields[2].isdigit():
                return int(fields[2]), fields[4]
        return None, None

    def launch(self) -> None:
        """Starts Astra. The CLI restarts the app if it is already running."""
        self.vega('launch-app', '-a', APP)

    def bring_forward(self) -> None:
        """Returns to a running Astra, as picking its tile on Home does."""
        self.cmd('vlcm launch-app pkg://' + APP)

    def send_home(self) -> None:
        # KEY_HOME is accepted and does nothing; KEY_HOMEPAGE is the button.
        self.press('HOMEPAGE')

    def terminate(self) -> None:
        self.vega('terminate-app', '-a', APP)

    def install(self, package_path: str) -> None:
        output = self.vega('install-app', '-p', package_path, timeout=300)
        if 'success' not in output:
            raise StickError('Install failed: ' + output.strip()[-300:])

    # -- log ---------------------------------------------------------------

    def start_log(self) -> None:
        """Records the system log on the stick for the length of the run.

        The stick keeps only its last few seconds of log, so anything that
        is to explain a failure has to be captured as it happens. The CLI
        hands nothing back until a command ends, so the log is written to a
        file on the stick by a command left running, and fetched afterwards.
        """
        self.cmd('killall loggingctl; rm -f ' + DEVICE_LOG)
        self._log = subprocess.Popen(
            ['vega', 'device', 'run-cmd', '-d', self.serial, '-c',
             'loggingctl log -f > %s 2>&1' % DEVICE_LOG],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def stop_log(self) -> Optional[str]:
        """Stops recording and returns where the log was saved, if it was."""
        if self._log is None:
            return None
        # Ending the command here leaves the recorder running on the stick.
        self.cmd('killall loggingctl')
        self._log.terminate()
        try:
            self._log.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._log.kill()
        self._log = None
        path = os.path.join(self.out_dir, 'stick.log')
        _run(
            ['vega', 'device', 'copy-from', '-d', self.serial,
             '-s', DEVICE_LOG, '-o', path]
        )
        self.cmd('rm -f ' + DEVICE_LOG)
        return path if os.path.exists(path) else None

    def standby_time(self, log_path: str) -> Optional[str]:
        """When the TV told the stick to go to sleep during the run, if it did.

        A TV that switches itself off sends standby over HDMI. The stick
        then turns its display off and ends every app, which looks exactly
        like Astra crashing.
        """
        try:
            with open(log_path, errors='replace') as log:
                for line in log:
                    if '[CEC] [RX]' in line and 'Standby' in line:
                        return ' '.join(line.split()[:3])
        except OSError:
            pass
        return None

    # -- screen ------------------------------------------------------------

    def shot(self, name: str) -> Image.Image:
        self._shots += 1
        path = os.path.join(self.out_dir, '%02d-%s.png' % (self._shots, name))
        self.cmd('gwsi-tool-screenshooter ' + DEVICE_SHOT)
        if os.path.exists(path):
            os.remove(path)
        _run(
            ['vega', 'device', 'copy-from', '-d', self.serial,
             '-s', DEVICE_SHOT, '-o', path]
        )
        if not os.path.exists(path):
            raise StickError('Could not fetch a screenshot from the stick.')
        return Image.open(path).convert('RGB')

    def screen_text(self, name: str) -> str:
        """Everything readable on screen, as one line of single-spaced words.

        The whole screen is read once, then its centre again on its own: a
        prompt drawn over dimmed video is often missed in the full-screen pass.
        """
        image = self.shot(name)
        width, height = image.size
        full = ImageOps.invert(ImageOps.grayscale(image.resize((1920, 1080))))
        centre = image.crop(
            (int(0.2 * width), int(0.3 * height),
             int(0.8 * width), int(0.7 * height))
        )
        centre = ImageOps.invert(
            ImageOps.grayscale(
                centre.resize((centre.width // 2, centre.height // 2))
            )
        )
        return ' '.join((_ocr(full, psm=11) + ' ' + _ocr(centre, psm=6)).split())

    def stats(self, name: str) -> Stats:
        image = self.shot(name)
        width, height = image.size
        left, top, right, bottom = STATS_BOX
        panel = image.crop(
            (int(left * width), int(top * height),
             int(right * width), int(bottom * height))
        )
        left, top, right, bottom = POSITION_BOX
        line = ImageOps.grayscale(
            image.crop(
                (int(left * width), int(top * height),
                 int(right * width), int(bottom * height))
            )
        )
        line = line.resize((line.width // 2, line.height // 2), Image.LANCZOS)
        return Stats(
            _ocr(ImageOps.invert(ImageOps.grayscale(panel))),
            _ocr(ImageOps.invert(line), psm=7),
            ImageOps.grayscale(image).getextrema()[1] < 8,
        )

    def wait_for_text(
        self, name: str, wanted: str, timeout: float = 30
    ) -> Optional[str]:
        deadline = time.time() + timeout
        while True:
            text = self.screen_text(name)
            if wanted.lower() in text.lower():
                return text
            if time.time() > deadline:
                return None
            time.sleep(1.5)
