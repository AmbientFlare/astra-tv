import React, {useCallback, useEffect, useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {JellyfinMediaItem, searchItems} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface SearchScreenProps {
  onBack?: () => void;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  serverProfile: ServerProfile;
}

export const SearchScreen = ({
  onBack,
  onSelectItem,
  serverProfile,
}: SearchScreenProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JellyfinMediaItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const runSearch = useCallback(
    async (searchTerm: string, mounted = true) => {
      setLoading(true);
      setErrorText(null);

      try {
        const items = await searchItems(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          serverProfile.userId,
          searchTerm,
        );

        if (mounted) {
          setResults(items);
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error ? error.message : 'Search failed.',
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    },
    [serverProfile],
  );

  useEffect(() => {
    let mounted = true;
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setResults([]);
      setErrorText(null);
      return () => {
        mounted = false;
      };
    }

    const timeout = setTimeout(() => runSearch(trimmedQuery, mounted), 350);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [query, runSearch]);

  return (
    <View style={styles.screen} testID="search-screen">
      <Text style={styles.title}>Search</Text>
      <FocusableItem
        focusedStyle={styles.backFocused}
        onPress={onBack}
        style={styles.backButton}
        testID="search-back-button">
        <Text style={styles.backText}>Back</Text>
      </FocusableItem>
      <TextInput
        autoCorrect={false}
        hasTVPreferredFocus={true}
        onChangeText={setQuery}
        placeholder="Movie, show, or episode"
        placeholderTextColor="#7E9098"
        style={styles.input}
        testID="search-input"
        value={query}
      />
      {isLoading ? <Text style={styles.status}>Searching...</Text> : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {errorText ? (
        <FocusableItem
          focusedStyle={styles.backFocused}
          onPress={() => runSearch(query.trim())}
          style={styles.retryButton}
          testID="search-retry-button">
          <Text style={styles.backText}>Retry</Text>
        </FocusableItem>
      ) : null}
      {!isLoading && query.trim().length >= 2 && results.length === 0 ? (
        <Text style={styles.status}>No results.</Text>
      ) : null}
      <TVFocusGuideView style={styles.gridGuide}>
        <FlatList
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={4}
          renderItem={({item}) => (
            <MediaCard
              imageUrl={item.imageUrl}
              onPress={() => onSelectItem?.(item)}
              subtitle={
                item.productionYear ? String(item.productionYear) : item.type
              }
              title={item.name}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 60,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
  },
  input: {
    width: 700,
    height: 62,
    borderRadius: 8,
    backgroundColor: '#182027',
    borderColor: '#4CC9F0',
    borderWidth: 2,
    color: '#FFFFFF',
    fontSize: 26,
    marginTop: 24,
    paddingHorizontal: 18,
  },
  backButton: {
    width: 120,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  backFocused: {
    backgroundColor: '#315066',
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  status: {
    color: '#B8C5CC',
    fontSize: 26,
    marginTop: 22,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 24,
    marginTop: 18,
  },
  retryButton: {
    width: 120,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  gridGuide: {
    flex: 1,
    marginTop: 32,
  },
  grid: {
    gap: 26,
    paddingBottom: 80,
  },
  gridRow: {
    gap: 26,
  },
});
