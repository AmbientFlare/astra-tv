import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {
  CURRENT_NOTICE_ID,
  languageLines,
  noticeBody,
  noticeTitle,
  WhatsNewNotice,
} from '../src/components/WhatsNewNotice';
import {APP_VERSION, BUILD_NUMBER} from '../src/config/app';
import {
  LANGUAGE_LINES,
  RELEASE_HIGHLIGHTS,
  SHOW_LANGUAGE_LINES,
} from '../src/config/releaseNotes';
import {LANGUAGES, setActiveLocale} from '../src/i18n';

describe("what's new notice", () => {
  afterEach(() => setActiveLocale('en'));

  it('renders the title, every highlight and a dismiss control', () => {
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);

    expect(screen.getByText(noticeTitle())).toBeTruthy();
    expect(noticeBody().length).toBeGreaterThan(0);
    noticeBody().forEach((highlight) => {
      expect(screen.getByText(`• ${highlight}`)).toBeTruthy();
    });
    expect(screen.getByTestId('whats-new-notice-ok')).toBeTruthy();
  });

  it('dismisses when the button is pressed', () => {
    const onDismiss = jest.fn();
    const screen = render(<WhatsNewNotice onDismiss={onDismiss} />);

    fireEvent.press(screen.getByTestId('whats-new-notice-ok'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('survives a host element with no requestTVFocus, and cleans up', () => {
    // The component asks for focus on a timer because the screen behind it
    // already holds focus; hasTVPreferredFocus alone did not take it back, and
    // the first centre press navigated away instead of dismissing. This pins
    // the optional-chaining guard and the timer cleanup only — that focus
    // actually lands is a device behaviour and is verified on hardware.
    jest.useFakeTimers();
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);

    expect(() => jest.runAllTimers()).not.toThrow();
    expect(() => screen.unmount()).not.toThrow();

    jest.useRealTimers();
  });

  it('ties the notice id to the version and build, so every build shows once', () => {
    // Test builds change more often than the version does, so the build number
    // is part of the id: each installed build earns exactly one prompt.
    expect(CURRENT_NOTICE_ID).toBe(`whats-new-${APP_VERSION}-${BUILD_NUMBER}`);
    expect(CURRENT_NOTICE_ID).toMatch(/^whats-new-\d+\.\d+\.\d+-\d{8}\.\d+$/);
  });

  it('does not promise anything on Amazon behalf or link outside the app', () => {
    const text = [
      noticeTitle(),
      ...Object.values(RELEASE_HIGHLIGHTS).flat(),
      ...Object.values(LANGUAGE_LINES),
    ]
      .join(' ')
      .toLowerCase();
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/refund|purchase|subscribe|pay/);
  });

  it('shows the notes in the language picked in Astra', () => {
    setActiveLocale('de');
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);

    expect(screen.getByText('Neu in Astra ' + APP_VERSION)).toBeTruthy();
    RELEASE_HIGHLIGHTS.de.forEach((highlight) => {
      expect(screen.getByText(`• ${highlight}`)).toBeTruthy();
    });
    expect(screen.queryByText(`• ${RELEASE_HIGHLIGHTS.en[0]}`)).toBeNull();
  });

  it('writes every release in every language, bullet for bullet', () => {
    // A release whose translation dropped or merged a bullet would show
    // different news depending on the language, so the counts must match.
    LANGUAGES.forEach(({locale}) => {
      expect(RELEASE_HIGHLIGHTS[locale].length).toBe(
        RELEASE_HIGHLIGHTS.en.length,
      );
      expect(LANGUAGE_LINES[locale].length).toBeGreaterThan(0);
    });
  });

  it('points to Settings > Language in every other language', () => {
    // Households updating from an English-only build never saw the first-run
    // picker, so the notice tells each language, in that language, where the
    // switch is. The line for the language already in use is left out.
    const lines = languageLines();
    if (!SHOW_LANGUAGE_LINES) {
      expect(lines).toEqual([]);
      return;
    }
    expect(lines).toHaveLength(LANGUAGES.length - 1);
    expect(lines).not.toContain(LANGUAGE_LINES.en);

    setActiveLocale('fr');
    const screen = render(<WhatsNewNotice onDismiss={jest.fn()} />);
    expect(screen.getByText(LANGUAGE_LINES.en)).toBeTruthy();
    expect(screen.getByText(LANGUAGE_LINES.de)).toBeTruthy();
    expect(screen.queryByText(LANGUAGE_LINES.fr)).toBeNull();
  });
});
