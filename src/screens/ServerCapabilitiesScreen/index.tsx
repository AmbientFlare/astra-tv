import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';

import {FocusableItem} from '../../components/FocusableItem';
import {
  VideoTranscodeCapability,
  updateServerCapabilities,
} from '../../services/serverCapabilities';
import {writePlaybackPreferences} from '../../services/storage';
import {
  CapabilityChoice,
  audioChannelChoices,
  videoTranscodeChoices,
} from './questions';

interface ServerCapabilitiesScreenProps {
  onDone: () => void;
  serverId: string;
  serverName: string;
}

type Step = 'video' | 'audio';

/**
 * The questions Astra cannot answer for itself, asked once per server.
 *
 * Everything the device can measure is measured instead of asked -- HDR
 * support comes from the `media.hdr` probe and bandwidth from the player's own
 * estimate, both of which beat a guess made with a remote control. What is
 * left is the two facts that live outside the device: what the server can do,
 * and what the room is plugged into.
 */
export const ServerCapabilitiesScreen = ({
  onDone,
  serverId,
  serverName,
}: ServerCapabilitiesScreenProps) => {
  const [step, setStep] = useState<Step>('video');
  const [saving, setSaving] = useState(false);

  const chooseVideo = (value: VideoTranscodeCapability) => {
    void updateServerCapabilities(serverId, {
      videoTranscode: value,
      // "I don't know" is an answer, but it is not a claim, so it stays
      // sourced as a default and detection may overwrite it without ever
      // counting as a contradiction worth reporting.
      videoTranscodeSource: value === 'unknown' ? 'default' : 'stated',
      // A storage failure must not strand anyone on the first question, so
      // the step advances either way; the fallback path still discovers an
      // unusable server on its own.
    }).catch(() => undefined);
    setStep('audio');
  };

  const chooseAudio = (value: 2 | 6) => {
    if (saving) return;
    setSaving(true);
    void Promise.all([
      updateServerCapabilities(serverId, {
        maxAudioChannels: value,
        maxAudioChannelsSource: 'stated',
        interviewCompleted: true,
      }),
      // Applied to the live profile as well as remembered against this
      // server, so the choice takes effect without waiting for a reconnect.
      writePlaybackPreferences({maxAudioChannels: value}),
    ])
      .catch(() => undefined)
      .finally(onDone);
  };

  const question =
    step === 'video'
      ? {
          title: 'Can your server convert video?',
          body:
            `Some video has to be converted before this device can play it. ` +
            `How ${serverName} does that decides how Astra asks for it.`,
        }
      : {
          title: 'How is your sound set up?',
          body: 'This decides how many audio channels Astra requests.',
        };

  const renderChoice = <Value,>(
    choice: CapabilityChoice<Value>,
    index: number,
    onSelect: (value: Value) => void,
  ) => (
    <FocusableItem
      focusedStyle={styles.choiceFocused}
      hasTVPreferredFocus={index === 0}
      key={String(choice.value)}
      onPress={() => onSelect(choice.value)}
      style={styles.choice}
      testID={`capability-choice-${String(choice.value)}`}>
      <Text style={styles.choiceLabel}>{choice.label}</Text>
      <Text style={styles.choiceDetail}>{choice.detail}</Text>
    </FocusableItem>
  );

  return (
    <View style={styles.screen} testID="server-capabilities-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>
          {step === 'video' ? 'Step 1 of 2' : 'Step 2 of 2'}
        </Text>
        <Text style={styles.title}>{question.title}</Text>
        <Text style={styles.body}>{question.body}</Text>
        <TVFocusGuideView style={styles.choices}>
          {step === 'video'
            ? videoTranscodeChoices.map((choice, index) =>
                renderChoice(choice, index, chooseVideo),
              )
            : audioChannelChoices.map((choice, index) =>
                renderChoice(choice, index, chooseAudio),
              )}
        </TVFocusGuideView>
        <Text style={styles.footnote}>
          You can change these later in Settings, and they are saved separately
          for each server you connect to.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#0E171E',
    flex: 1,
  },
  content: {
    paddingHorizontal: 64,
    paddingVertical: 48,
  },
  step: {
    color: '#8CA1AA',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: '#C7D4DA',
    fontSize: 21,
    lineHeight: 29,
    marginBottom: 28,
    maxWidth: 900,
  },
  choices: {
    gap: 12,
  },
  choice: {
    backgroundColor: '#24313A',
    borderRadius: 10,
    justifyContent: 'center',
    maxWidth: 900,
    minHeight: 88,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  choiceFocused: {
    backgroundColor: '#2E5A72',
  },
  choiceLabel: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  choiceDetail: {
    color: '#C7D4DA',
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
  },
  footnote: {
    color: '#8CA1AA',
    fontSize: 17,
    lineHeight: 23,
    marginTop: 28,
    maxWidth: 900,
  },
});
