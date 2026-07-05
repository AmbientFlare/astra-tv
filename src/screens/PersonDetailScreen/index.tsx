import React, {useCallback, useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {
  getItemsByPerson,
  getPerson,
  JellyfinMediaItem,
  JellyfinPerson,
  setFavorite,
} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface PersonDetailScreenProps {
  onBack?: () => void;
  onSelectEpisode?: (item: JellyfinMediaItem) => void;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  personId: string;
  personName?: string;
  serverProfile: ServerProfile;
}

const formatBorn = (birthDate?: string) => {
  if (!birthDate) {
    return null;
  }

  const date = new Date(birthDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const birthdayPassed =
    now.getMonth() > date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() >= date.getDate());

  if (!birthdayPassed) {
    age -= 1;
  }

  return `Born ${date.toLocaleDateString()} (${age})`;
};

export const PersonDetailScreen = ({
  onBack,
  onSelectEpisode,
  onSelectItem,
  personId,
  personName,
  serverProfile,
}: PersonDetailScreenProps) => {
  const [person, setPerson] = useState<JellyfinPerson | null>(null);
  const [appearances, setAppearances] = useState<JellyfinMediaItem[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isUpdatingFavorite, setUpdatingFavorite] = useState(false);

  const load = useCallback(
    async (mounted = true) => {
      setErrorText(null);

      try {
        const [personResult, appearanceResults] = await Promise.all([
          getPerson(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            personId,
            personName,
          ),
          getItemsByPerson(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            serverProfile.userId,
            personId,
          ),
        ]);

        if (mounted) {
          setPerson(personResult);
          setAppearances(appearanceResults);
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error
              ? error.message
              : 'Unable to load person details.',
          );
        }
      }
    },
    [personId, personName, serverProfile],
  );

  useEffect(() => {
    let mounted = true;

    load(mounted);

    return () => {
      mounted = false;
    };
  }, [load]);

  const updateFavorite = async () => {
    if (!person) {
      return;
    }

    const nextValue = !person.isFavorite;
    setUpdatingFavorite(true);
    setPerson((current) =>
      current ? {...current, isFavorite: nextValue} : current,
    );

    try {
      await setFavorite(
        serverProfile.serverUrl,
        serverProfile.accessToken,
        serverProfile.userId,
        person.id,
        nextValue,
      );
    } catch {
      setPerson((current) =>
        current ? {...current, isFavorite: !nextValue} : current,
      );
    } finally {
      setUpdatingFavorite(false);
    }
  };

  return (
    <ScrollView style={styles.screen} testID="person-detail-screen">
      <View style={styles.hero}>
        {person?.imageUrl ? (
          <Image source={{uri: person.imageUrl}} style={styles.portrait} />
        ) : null}
        <View style={styles.copy}>
          <Text style={styles.title}>{person?.name ?? 'Person'}</Text>
          {formatBorn(person?.birthDate) ? (
            <Text style={styles.meta}>{formatBorn(person?.birthDate)}</Text>
          ) : null}
          <Text numberOfLines={6} style={styles.overview}>
            {person?.overview ?? 'No biography available.'}
          </Text>
          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
          <TVFocusGuideView style={styles.actions}>
            <FocusableItem
              disabled={!person || isUpdatingFavorite}
              focusedStyle={styles.actionFocused}
              hasTVPreferredFocus={true}
              onPress={updateFavorite}
              style={styles.actionButton}
              testID="person-favorite-button">
              <Text style={styles.actionText}>
                {person?.isFavorite ? 'Unfavorite' : 'Favorite'}
              </Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.actionFocused}
              onPress={onBack}
              style={styles.actionButton}
              testID="person-back-button">
              <Text style={styles.actionText}>Back</Text>
            </FocusableItem>
          </TVFocusGuideView>
        </View>
      </View>

      {appearances.length ? (
        <>
          <Text style={styles.sectionTitle}>Episodes & Appearances</Text>
          <ScrollView horizontal={true} style={styles.rowScroller}>
            <TVFocusGuideView style={styles.row}>
              {appearances.map((item) => (
                <MediaCard
                  imageUrl={item.imageUrl}
                  key={item.id}
                  onPress={() =>
                    item.type === 'Episode'
                      ? onSelectEpisode?.(item)
                      : onSelectItem?.(item)
                  }
                  subtitle={
                    item.seriesName ??
                    (item.productionYear
                      ? String(item.productionYear)
                      : item.type)
                  }
                  title={item.name}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
  },
  hero: {
    flexDirection: 'row',
    gap: 36,
    padding: 72,
  },
  portrait: {
    width: 260,
    height: 390,
    borderRadius: 8,
    backgroundColor: '#182027',
  },
  copy: {
    flex: 1,
    paddingTop: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
  },
  meta: {
    color: '#B8C5CC',
    fontSize: 24,
    marginTop: 12,
  },
  overview: {
    color: '#E4ECEF',
    fontSize: 25,
    lineHeight: 34,
    marginTop: 22,
    maxWidth: 980,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 22,
    marginTop: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 28,
  },
  actionButton: {
    minWidth: 138,
    height: 58,
    borderRadius: 8,
    backgroundColor: '#25313A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  actionFocused: {
    backgroundColor: '#2E5A72',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 14,
    marginHorizontal: 72,
  },
  rowScroller: {
    marginBottom: 36,
    paddingHorizontal: 72,
  },
  row: {
    flexDirection: 'row',
    gap: 26,
  },
});
