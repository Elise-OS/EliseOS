import {
  ARTE_LIVE_URL,
  RMC_DECOUVERTE_LIVE_URL,
  RMC_LIFE_LIVE_URL,
  RMC_STORY_LIVE_URL,
  youtubeVideoId,
} from '@michel/contracts';
import type {
  ScreenMedia,
  ScreenPodcastEpisode,
  ScreenPodcastSearchResult,
  ScreenScheduledContentInput,
  ScreenSettings,
  ScreenSnapshot,
} from '@michel/contracts';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi, type ScreenRadioStation } from '../api';
import type { SavedServer } from '../discovery/types';
import { MobileDateTimePicker } from '../MobileDateTimePicker';
import { activeServerUrl } from '../discovery/helpers';

const c = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  paleGreen: '#E5EFE8',
  amber: '#D99A55',
  paleAmber: '#F7E9D7',
  red: '#B74747',
  paleBlue: '#E8F0F3',
};

const messageEmojis = ['❤️', '😊', '🥰', '😘', '🌸', '☀️', '🎂', '👏', '💐', '👋', '✨', '☕'];
const favoriteMessages = [
  { emoji: '☀️', label: 'Bonne journée', message: 'Bonne journée ! On pense fort à toi ❤️' },
  {
    emoji: '📅',
    label: 'Rendez-vous',
    message: 'N’oublie pas ton rendez-vous. Tout est bien prévu 😊',
  },
  { emoji: '🏡', label: 'On arrive', message: 'On arrive bientôt ! À tout de suite 👋' },
];
const liveChannels = [
  {
    title: 'ARTE en direct',
    url: ARTE_LIVE_URL,
    note: 'Culture, documentaires et cinéma.',
    brand: 'arte',
    brandLabel: 'arte',
  },
  {
    title: 'RMC Life',
    url: RMC_LIFE_LIVE_URL,
    note: 'Divertissement et programmes du quotidien.',
    brand: 'rmc-life',
    brandLabel: 'RMC',
  },
  {
    title: 'RMC Story',
    url: RMC_STORY_LIVE_URL,
    note: 'Documentaires et magazines.',
    brand: 'rmc-story',
    brandLabel: 'RMC',
  },
  {
    title: 'RMC Découverte',
    url: RMC_DECOUVERTE_LIVE_URL,
    note: 'Découverte, sciences et aventures.',
    brand: 'rmc-decouverte',
    brandLabel: 'RMC',
  },
];
const slideshowOptions = [5, 10, 15, 30, 60, 120];

type MainTab = 'album' | 'messages' | 'medias';
type MediaSource = 'tv' | 'radio' | 'podcasts' | 'youtube';
type ScheduleTarget = 'photo' | 'message';
type ScheduleMode = 'date' | 'time';

export function MobileScreenTabs({
  server,
  token,
  snapshot,
  onChanged,
}: {
  server: SavedServer;
  token: string;
  snapshot?: ScreenSnapshot;
  onChanged: () => void;
}) {
  const [selectedTab, setSelectedTab] = useState<MainTab>('album');
  const [mediaSource, setMediaSource] = useState<MediaSource>('tv');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | undefined>(undefined);
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoScheduleAt, setPhotoScheduleAt] = useState<Date | null>(null);
  const [messageScheduleAt, setMessageScheduleAt] = useState<Date | null>(null);
  const [activePicker, setActivePicker] = useState<{
    target: ScheduleTarget;
    mode: ScheduleMode;
  } | null>(null);
  const [pickerDraft, setPickerDraft] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [slideshowDraft, setSlideshowDraft] = useState<number | null>(null);
  const [messages, setMessages] = useState<string[]>(['']);
  const [messageIndex, setMessageIndex] = useState(0);
  const [messageInterval, setMessageInterval] = useState(20);
  const [messageDirty, setMessageDirty] = useState(false);
  const lastMessageSnapshot = useRef<string | undefined>(undefined);
  const [radioQuery, setRadioQuery] = useState('');
  const [radioResults, setRadioResults] = useState<ScreenRadioStation[]>([]);
  const [podcastQuery, setPodcastQuery] = useState('');
  const [podcastResults, setPodcastResults] = useState<ScreenPodcastSearchResult[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<ScreenPodcastSearchResult | undefined>(
    undefined,
  );
  const [podcastEpisodes, setPodcastEpisodes] = useState<ScreenPodcastEpisode[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeTitle, setYoutubeTitle] = useState('');

  const canControl = Boolean(snapshot?.grant.control);
  const canMessage = Boolean(snapshot?.grant.message);
  const tabs = [
    {
      id: 'album' as const,
      title: 'Album photo',
      icon: 'images-outline' as const,
      allowed: canControl,
    },
    {
      id: 'messages' as const,
      title: 'Messages',
      icon: 'chatbubble-ellipses-outline' as const,
      allowed: canMessage,
    },
    {
      id: 'medias' as const,
      title: 'Médias',
      icon: 'play-circle-outline' as const,
      allowed: canControl,
    },
  ].filter((tab) => tab.allowed);
  const activeTab = tabs.some((tab) => tab.id === selectedTab)
    ? selectedTab
    : (tabs[0]?.id ?? 'album');
  const screenState = snapshot?.state;
  const base = activeServerUrl(server).replace(/\/$/, '');
  const residentName = snapshot?.resident.trim().split(/\s+/)[0] || 'la personne accompagnée';
  const scheduledValue = (target: ScheduleTarget) =>
    target === 'photo' ? photoScheduleAt : messageScheduleAt;
  const setScheduledValue = (target: ScheduleTarget, value: Date | null) => {
    if (target === 'photo') setPhotoScheduleAt(value);
    else setMessageScheduleAt(value);
  };
  const applyPickerValue = (target: ScheduleTarget, mode: ScheduleMode, selected: Date) => {
    const current = scheduledValue(target);
    const next = current ? new Date(current) : new Date(Date.now() + 60 * 60 * 1000);
    if (mode === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    setScheduledValue(target, next);
  };
  const openSchedulePicker = (target: ScheduleTarget, mode: ScheduleMode) => {
    const value = scheduledValue(target) ?? new Date(Date.now() + 60 * 60 * 1000);
    const onChange = (_event: unknown, selected?: Date) => {
      if (selected) applyPickerValue(target, mode, selected);
    };
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        display: mode === 'date' ? 'calendar' : 'clock',
        is24Hour: true,
        onChange,
      });
      return;
    }
    setPickerDraft(value);
    setActivePicker({ target, mode });
  };
  const confirmPicker = () => {
    if (!activePicker) return;
    applyPickerValue(activePicker.target, activePicker.mode, pickerDraft);
    setActivePicker(null);
  };

  const incomingMessages = screenState?.messages?.length
    ? screenState.messages
    : [screenState?.message ?? ''];
  const incomingMessageKey = JSON.stringify({
    messages: incomingMessages,
    interval: screenState?.messageIntervalSeconds ?? 20,
  });
  useEffect(() => {
    if (!screenState || messageDirty || lastMessageSnapshot.current === incomingMessageKey) return;
    setMessages([...incomingMessages]);
    setMessageInterval(screenState.messageIntervalSeconds ?? 20);
    setMessageIndex(0);
    lastMessageSnapshot.current = incomingMessageKey;
  }, [incomingMessageKey, messageDirty, screenState, incomingMessages]);

  const run = async (action: () => Promise<void>, refresh = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      if (refresh) onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de terminer cette action.');
    } finally {
      setBusy(false);
    }
  };

  const addTextToMessage = (value: string) => {
    setMessageDirty(true);
    setMessages((current) => current.map((text, index) => (index === messageIndex ? value : text)));
  };

  const saveMessages = () =>
    run(async () => {
      const savedMessages = messages.map((message) => message.trim());
      if (
        !savedMessages.length ||
        savedMessages.some((message) => !message) ||
        savedMessages.length > 20 ||
        !Number.isInteger(messageInterval) ||
        messageInterval < 5 ||
        messageInterval > 600
      ) {
        throw new Error(
          'Chaque message doit contenir du texte. La durée doit être entre 5 et 600 secondes.',
        );
      }
      if (messageScheduleAt && messageScheduleAt.getTime() <= Date.now())
        throw new Error('Choisissez une heure future pour programmer le message.');
      if (messageScheduleAt) {
        const scheduled: ScreenScheduledContentInput = {
          kind: 'message',
          scheduledAt: messageScheduleAt,
          messages: savedMessages,
          messageIntervalSeconds: messageInterval,
        };
        await mobileApi.scheduleScreenContent(server, token, scheduled);
        setMessageScheduleAt(null);
        setMessageDirty(false);
        return;
      }
      await mobileApi.updateScreenMessage(server, token, {
        messages: savedMessages,
        messageIntervalSeconds: messageInterval,
      });
      setMessages(savedMessages);
      setMessageDirty(false);
    }, true);

  const clearMessages = () =>
    run(async () => {
      await mobileApi.updateScreenMessage(server, token, { messages: [] });
      setMessages(['']);
      setMessageIndex(0);
      setMessageDirty(false);
    }, true);

  const pickPhoto = async () => {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        selectionLimit: 1,
      });
      if (!result.canceled) setPhoto(result.assets[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’ouvrir la photothèque.');
    }
  };

  const uploadPhoto = () =>
    run(async () => {
      if (!photo) return;
      if (photoScheduleAt && photoScheduleAt.getTime() <= Date.now())
        throw new Error('Choisissez une heure future pour programmer la photo.');
      const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      let fileName = photo.fileName || `elise-photo-${Date.now()}.jpg`;
      const form = new FormData();
      let uploaded: ScreenSnapshot;
      if (Platform.OS === 'web' && photo.file && acceptedTypes.has(photo.mimeType ?? '')) {
        if (photo.file.size > 100 * 1024 * 1024)
          throw new Error('La photo doit faire moins de 100 Mo.');
        form.append('file', photo.file, fileName);
        uploaded = await mobileApi.uploadScreenPhoto(server, token, form);
      } else {
        const resize =
          Math.max(photo.width, photo.height) > 2560
            ? [
                {
                  resize: photo.width >= photo.height ? { width: 2560 } : { height: 2560 },
                },
              ]
            : [];
        const normalized = await ImageManipulator.manipulateAsync(photo.uri, resize, {
          compress: 0.86,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        fileName = `elise-photo-${Date.now()}.jpg`;
        form.append('file', {
          uri: normalized.uri,
          name: fileName,
          type: 'image/jpeg',
        } as unknown as Blob);
        uploaded = await mobileApi.uploadScreenPhoto(server, token, form);
      }
      const media = uploaded.state.media[uploaded.state.media.length - 1];
      if (!media || media.kind !== 'photo') throw new Error('Photo introuvable après l’envoi.');
      await mobileApi.createScreenMedia(server, token, {
        ...media,
        title: photoCaption.trim().slice(0, 120),
      });
      if (photoScheduleAt) {
        const scheduled: ScreenScheduledContentInput = {
          kind: 'photo',
          mediaId: media.id,
          scheduledAt: photoScheduleAt,
        };
        await mobileApi.scheduleScreenContent(server, token, scheduled);
      }
      setPhoto(undefined);
      setPhotoCaption('');
      setPhotoScheduleAt(null);
    }, true);

  const saveSlideshowSpeed = () =>
    run(async () => {
      if (!screenState || slideshowDraft === null) return;
      const settings: ScreenSettings = {
        ...screenState.settings,
        slideshowSeconds: slideshowDraft,
      };
      await mobileApi.updateScreenSettings(server, token, settings);
      setSlideshowDraft(null);
    }, true);

  const searchRadio = () => {
    const query = radioQuery.trim();
    if (query.length < 2) return;
    void run(async () => {
      setRadioResults(await mobileApi.searchScreenRadio(server, token, query));
    });
  };

  const searchPodcasts = () => {
    const query = podcastQuery.trim();
    if (query.length < 2) return;
    setSelectedPodcast(undefined);
    setPodcastEpisodes([]);
    void run(async () => {
      setPodcastResults(await mobileApi.searchScreenPodcasts(server, token, query));
    });
  };

  const togglePodcast = (podcast: ScreenPodcastSearchResult) => {
    if (selectedPodcast?.id === podcast.id) {
      setSelectedPodcast(undefined);
      setPodcastEpisodes([]);
      return;
    }
    if (busy) return;
    setSelectedPodcast(podcast);
    setPodcastEpisodes([]);
    void run(async () => {
      setPodcastEpisodes(await mobileApi.screenPodcastEpisodes(server, token, podcast.id));
    });
  };

  const playPodcastEpisode = (podcast: ScreenPodcastSearchResult, episode: ScreenPodcastEpisode) =>
    run(async () => {
      const followed = (screenState?.podcasts ?? []).some((item) => item.id === podcast.id);
      if (!followed) await mobileApi.followScreenPodcast(server, token, podcast.id);
      await mobileApi.playScreenPodcastEpisode(server, token, podcast.id, episode.id);
    }, true);

  const mediaIdForUrl = (kind: ScreenMedia['kind'], url: string) =>
    screenState?.media.find((item) => item.kind === kind && item.url === url)?.id ?? createUuid();

  const playLiveChannel = (channel: (typeof liveChannels)[number]) =>
    run(async () => {
      if (!snapshot?.online || screenState?.call)
        throw new Error('La TV doit être connectée pour lancer une chaîne.');
      const id = mediaIdForUrl('tv', channel.url);
      await mobileApi.createScreenMedia(server, token, {
        id,
        title: channel.title,
        kind: 'tv',
        url: channel.url,
      });
      await mobileApi.screenCommand(server, token, { action: 'play', mediaId: id });
    }, true);

  const playRadio = (station: ScreenRadioStation) =>
    run(async () => {
      if (!snapshot?.online || screenState?.call)
        throw new Error('La TV doit être connectée pour lancer une radio.');
      const existing = screenState?.media.find(
        (item) => item.kind === 'stream' && item.url === station.url,
      );
      const id = existing?.id ?? createUuid();
      await mobileApi.createScreenMedia(server, token, {
        id,
        title: station.name,
        kind: 'stream',
        url: station.url,
        ...(station.artworkUrl || existing?.artworkUrl
          ? { artworkUrl: station.artworkUrl ?? existing?.artworkUrl }
          : {}),
      });
      await mobileApi.screenCommand(server, token, { action: 'play', mediaId: id });
    }, true);

  const addYoutube = () => {
    const url = youtubeUrl.trim();
    const videoId = youtubeVideoId(url);
    if (!videoId) {
      setError('Saisissez un lien vidéo YouTube valide.');
      return;
    }
    void run(async () => {
      const title = youtubeTitle.trim() || `YouTube · ${videoId}`;
      const id = mediaIdForUrl('youtube', url);
      await mobileApi.createScreenMedia(server, token, { id, title, kind: 'youtube', url });
      if (snapshot?.online && !screenState?.call)
        await mobileApi.screenCommand(server, token, { action: 'play', mediaId: id });
      setYoutubeUrl('');
      setYoutubeTitle('');
    }, true);
  };

  const playMedia = (media: ScreenMedia) =>
    run(async () => {
      if (!snapshot?.online || screenState?.call)
        throw new Error('La TV doit être connectée pour lancer un média.');
      await mobileApi.screenCommand(server, token, { action: 'play', mediaId: media.id });
    }, true);

  const removeMedia = (media: ScreenMedia) =>
    run(() => mobileApi.removeScreenMedia(server, token, media.id).then(() => undefined), true);

  if (!tabs.length) return null;

  const photos = screenState?.media.filter((media) => media.kind === 'photo') ?? [];
  const savedRadio = screenState?.media.filter((media) => media.kind === 'stream') ?? [];
  const savedYoutube = screenState?.media.filter((media) => media.kind === 'youtube') ?? [];
  const currentMessage = messages[messageIndex] ?? '';
  const currentSpeed = slideshowDraft ?? screenState?.settings.slideshowSeconds ?? 15;
  const scheduledKind =
    activeTab === 'album' ? 'photo' : activeTab === 'messages' ? 'message' : null;
  const upcomingContent = scheduledKind
    ? (screenState?.scheduledContent ?? [])
        .filter((item) => item.kind === scheduledKind)
        .sort((left, right) => left.scheduledAt - right.scheduledAt)
    : [];
  const youtubeIsValid = Boolean(youtubeVideoId(youtubeUrl.trim()));

  return (
    <View style={s.container}>
      <View style={s.mainTabs} accessibilityRole="tablist">
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.id }}
            style={[s.mainTab, activeTab === tab.id && s.mainTabActive]}
            onPress={() => setSelectedTab(tab.id)}
          >
            <Ionicons name={tab.icon} size={17} color={activeTab === tab.id ? '#fff' : c.muted} />
            <Text style={[s.mainTabText, activeTab === tab.id && s.mainTabTextActive]}>
              {tab.title}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}

      {activeTab === 'album' ? (
        <View style={s.card}>
          <View style={s.heading}>
            <View style={s.headingIcon}>
              <Ionicons name="images-outline" size={19} color={c.blue} />
            </View>
            <View style={s.flex}>
              <Text style={s.title}>Album photo</Text>
              <Text style={s.detail}>Chaque photo défile avec son commentaire.</Text>
            </View>
          </View>
          <Pressable disabled={busy} style={s.pickButton} onPress={() => void pickPhoto()}>
            <Ionicons name="image-outline" size={19} color={c.blue} />
            <View style={s.flex}>
              <Text style={s.pickTitle}>{photo?.fileName ?? 'Choisir dans la photothèque'}</Text>
              <Text style={s.pickDetail}>JPG, PNG ou WebP · 100 Mo maximum</Text>
            </View>
            <Ionicons name="add-circle-outline" size={21} color={c.accent} />
          </Pressable>
          {photo ? (
            <>
              <View style={s.photoDraft}>
                <Image source={{ uri: photo.uri }} style={s.photoPreview} />
                <View style={s.flex}>
                  <TextInput
                    value={photoCaption}
                    maxLength={120}
                    onChangeText={setPhotoCaption}
                    placeholder="Commentaire sous la photo (facultatif)"
                    placeholderTextColor={c.muted}
                    style={s.input}
                  />
                  <Text style={s.counter}>{photoCaption.length}/120</Text>
                </View>
                <Pressable
                  accessibilityLabel="Retirer la photo sélectionnée"
                  onPress={() => setPhoto(undefined)}
                >
                  <Ionicons name="close-circle" size={22} color={c.muted} />
                </Pressable>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chipRow}
              >
                {messageEmojis.map((emoji) => (
                  <Pressable
                    key={emoji}
                    accessibilityLabel={`Ajouter ${emoji} au commentaire`}
                    style={s.emojiButton}
                    onPress={() =>
                      setPhotoCaption(
                        (current) =>
                          `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`,
                      )
                    }
                  >
                    <Text style={s.emojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScheduleControls
                value={photoScheduleAt}
                onDate={() => openSchedulePicker('photo', 'date')}
                onTime={() => openSchedulePicker('photo', 'time')}
                onClear={() => setPhotoScheduleAt(null)}
                disabled={busy}
              />
            </>
          ) : null}
          <Pressable
            disabled={!photo || busy}
            style={[s.primaryButton, (!photo || busy) && s.disabledButton]}
            onPress={() => void uploadPhoto()}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={s.primaryButtonText}>
              {busy
                ? 'Ajout en cours…'
                : photoScheduleAt
                  ? 'Programmer la photo'
                  : 'Ajouter à l’album'}
            </Text>
          </Pressable>

          <View style={s.subheadingRow}>
            <View style={s.flex}>
              <Text style={s.subheading}>Album de {residentName}</Text>
              <Text style={s.detail}>
                {photos.length} photo{photos.length === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={s.speedControl}>
              <Pressable
                accessibilityLabel="Réduire le temps par photo"
                disabled={busy}
                style={s.roundButton}
                onPress={() => {
                  const index = slideshowOptions.indexOf(currentSpeed);
                  setSlideshowDraft(slideshowOptions[Math.max(0, index - 1)] ?? 5);
                }}
              >
                <Ionicons name="remove" size={16} color={c.blue} />
              </Pressable>
              <Text style={s.speedValue}>
                {currentSpeed >= 60 ? `${currentSpeed / 60} min` : `${currentSpeed} s`}
              </Text>
              <Pressable
                accessibilityLabel="Augmenter le temps par photo"
                disabled={busy}
                style={s.roundButton}
                onPress={() => {
                  const index = slideshowOptions.indexOf(currentSpeed);
                  setSlideshowDraft(
                    slideshowOptions[Math.min(slideshowOptions.length - 1, index + 1)] ?? 120,
                  );
                }}
              >
                <Ionicons name="add" size={16} color={c.blue} />
              </Pressable>
            </View>
          </View>
          {slideshowDraft !== null && slideshowDraft !== screenState?.settings.slideshowSeconds ? (
            <Pressable
              disabled={busy}
              style={s.secondaryButton}
              onPress={() => void saveSlideshowSpeed()}
            >
              <Text style={s.secondaryButtonText}>Enregistrer le rythme du diaporama</Text>
            </Pressable>
          ) : null}
          {photos.length ? (
            <View style={s.photoGrid}>
              {photos.map((media) => (
                <View key={media.id} style={s.photoCard}>
                  <ScreenMediaImage
                    url={media.url}
                    base={base}
                    token={token}
                    style={s.libraryPhoto}
                    resizeMode="cover"
                  />
                  <Text numberOfLines={2} style={s.photoTitle}>
                    {media.title || 'Photo de l’album'}
                  </Text>
                  <View style={s.photoActions}>
                    <Pressable
                      accessibilityLabel={`Retirer ${media.title || 'cette photo'} de l’album`}
                      disabled={busy}
                      style={s.iconAction}
                      onPress={() => void removeMedia(media)}
                    >
                      <Ionicons name="trash-outline" size={16} color={c.red} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.emptyText}>Aucune photo ajoutée pour le moment.</Text>
          )}
        </View>
      ) : null}

      {activeTab === 'messages' ? (
        <View style={s.card}>
          <View style={s.heading}>
            <View style={[s.headingIcon, s.headingGreen]}>
              <Ionicons name="chatbubble-ellipses-outline" size={19} color={c.green} />
            </View>
            <View style={s.flex}>
              <Text style={s.title}>Message sur la TV</Text>
              <Text style={s.detail}>Les messages restent visibles et se succèdent à l’écran.</Text>
            </View>
          </View>
          <Text style={s.fieldLabel}>Messages favoris</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            {favoriteMessages.map((favorite) => (
              <Pressable
                key={favorite.label}
                style={s.favoriteChip}
                onPress={() => {
                  setMessages((current) =>
                    current.map((value, index) =>
                      index === messageIndex ? favorite.message : value,
                    ),
                  );
                  setMessageDirty(true);
                }}
              >
                <Text style={s.favoriteEmoji}>{favorite.emoji}</Text>
                <Text style={s.favoriteText}>{favorite.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            {messages.map((message, index) => (
              <Pressable
                key={`message-${index}`}
                accessibilityRole="button"
                accessibilityState={{ selected: index === messageIndex }}
                style={[s.messageChip, index === messageIndex && s.messageChipActive]}
                onPress={() => setMessageIndex(index)}
              >
                <Text
                  style={[s.messageChipText, index === messageIndex && s.messageChipTextActive]}
                >
                  Message {index + 1}
                  {message.trim() ? '' : ' · vide'}
                </Text>
              </Pressable>
            ))}
            <Pressable
              disabled={messages.length >= 20}
              style={s.addMessageChip}
              onPress={() => {
                setMessages((current) => [...current, '']);
                setMessageIndex(messages.length);
                setMessageDirty(true);
              }}
            >
              <Ionicons name="add" size={16} color={c.blue} />
              <Text style={s.messageChipText}>Ajouter</Text>
            </Pressable>
          </ScrollView>
          <View style={s.emojiRow}>
            {messageEmojis.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityLabel={`Ajouter ${emoji}`}
                style={s.emojiButton}
                onPress={() => {
                  const next = `${currentMessage}${currentMessage && !currentMessage.endsWith(' ') ? ' ' : ''}${emoji}`;
                  addTextToMessage(next);
                }}
              >
                <Text style={s.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            multiline
            maxLength={1000}
            value={currentMessage}
            onChangeText={addTextToMessage}
            placeholder={`Bonne journée ${residentName} ! On pense fort à toi ❤️`}
            placeholderTextColor={c.muted}
            style={[s.input, s.messageInput]}
            textAlignVertical="top"
          />
          <Text style={s.counter}>
            {currentMessage.length}/1000 · {messages.length}/20 messages
          </Text>
          <View style={s.messageTiming}>
            <View style={s.flex}>
              <Text style={s.fieldLabel}>Durée de chaque message</Text>
              <Text style={s.detail}>Les messages tournent dans cet ordre.</Text>
            </View>
            <TextInput
              accessibilityLabel="Durée en secondes"
              keyboardType="number-pad"
              value={String(messageInterval)}
              onChangeText={(value) => {
                setMessageInterval(Number(value));
                setMessageDirty(true);
              }}
              style={s.secondsInput}
            />
            <Text style={s.detail}>s</Text>
          </View>
          <ScheduleControls
            value={messageScheduleAt}
            onDate={() => openSchedulePicker('message', 'date')}
            onTime={() => openSchedulePicker('message', 'time')}
            onClear={() => setMessageScheduleAt(null)}
            disabled={busy}
          />
          <View style={s.actionRow}>
            {messages.length > 1 ? (
              <Pressable
                disabled={busy}
                style={s.secondaryButton}
                onPress={() => {
                  setMessages((current) => current.filter((_, index) => index !== messageIndex));
                  setMessageIndex(Math.max(0, messageIndex - 1));
                  setMessageDirty(true);
                }}
              >
                <Ionicons name="remove-circle-outline" size={16} color={c.muted} />
                <Text style={s.secondaryButtonText}>Retirer</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={busy}
              style={s.secondaryButton}
              onPress={() => void clearMessages()}
            >
              <Ionicons name="trash-outline" size={16} color={c.muted} />
              <Text style={s.secondaryButtonText}>Effacer</Text>
            </Pressable>
            <Pressable
              disabled={busy || (!messageDirty && !messageScheduleAt)}
              style={[
                s.primaryButton,
                (busy || (!messageDirty && !messageScheduleAt)) && s.disabledButton,
              ]}
              onPress={() => void saveMessages()}
            >
              <Ionicons
                name={messageScheduleAt ? 'calendar-outline' : 'heart-outline'}
                size={17}
                color="#fff"
              />
              <Text style={s.primaryButtonText}>
                {busy
                  ? 'Enregistrement…'
                  : messageScheduleAt
                    ? 'Programmer le message'
                    : 'Afficher sur la TV'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {activeTab === 'medias' ? (
        <View style={s.card}>
          <View style={s.heading}>
            <View style={[s.headingIcon, s.headingAmber]}>
              <Ionicons name="play-circle-outline" size={20} color={c.amber} />
            </View>
            <View style={s.flex}>
              <Text style={s.title}>Médias</Text>
              <Text style={s.detail}>Choisissez ce que {residentName} regarde ou écoute.</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.sourceTabs}
          >
            {(
              [
                ['youtube', 'YouTube', 'logo-youtube'],
                ['tv', 'TV en direct', 'tv-outline'],
                ['radio', 'Radio', 'radio-outline'],
                ['podcasts', 'Podcasts', 'headset-outline'],
              ] as const
            ).map(([id, title, icon]) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: mediaSource === id }}
                style={[s.sourceTab, mediaSource === id && s.sourceTabActive]}
                onPress={() => setMediaSource(id)}
              >
                <Ionicons name={icon} size={15} color={mediaSource === id ? c.blue : c.muted} />
                <Text style={[s.sourceTabText, mediaSource === id && s.sourceTabTextActive]}>
                  {title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {mediaSource === 'tv' ? (
            <View style={s.mediaList}>
              {liveChannels.map((channel) => (
                <View key={channel.url} style={s.sourceCard}>
                  <View
                    style={[
                      s.channelBrand,
                      channel.brand === 'arte' ? s.channelBrandArte : s.channelBrandRmc,
                    ]}
                  >
                    <Text
                      style={[
                        s.channelBrandText,
                        channel.brand === 'arte' ? s.channelBrandTextArte : s.channelBrandTextRmc,
                      ]}
                    >
                      {channel.brandLabel}
                    </Text>
                  </View>
                  <View style={s.flex}>
                    <Text style={s.mediaTitle}>{channel.title}</Text>
                    <Text style={s.mediaSubtitle}>{channel.note}</Text>
                  </View>
                  <Pressable
                    disabled={busy || !snapshot?.online}
                    style={s.playButton}
                    onPress={() => void playLiveChannel(channel)}
                  >
                    <Ionicons name="play" size={15} color="#fff" />
                    <Text style={s.playButtonText}>Regarder</Text>
                  </Pressable>
                </View>
              ))}
              {screenState?.media
                .filter(
                  (media) =>
                    media.kind === 'tv' &&
                    !liveChannels.some((channel) => channel.url === media.url),
                )
                .map((media) => (
                  <View key={media.id} style={s.mediaRow}>
                    <View style={s.mediaPlaceholder}>
                      <Ionicons name="tv-outline" size={18} color={c.accent} />
                    </View>
                    <View style={s.flex}>
                      <Text numberOfLines={1} style={s.mediaTitle}>
                        {media.title || 'Chaîne TV'}
                      </Text>
                      <Text style={s.mediaSubtitle}>Chaîne enregistrée</Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`Lire ${media.title || 'cette chaîne'}`}
                      disabled={busy || !snapshot?.online}
                      style={s.iconAction}
                      onPress={() => void playMedia(media)}
                    >
                      <Ionicons name="play" size={17} color={c.blue} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Retirer ${media.title || 'cette chaîne'}`}
                      disabled={busy}
                      style={s.iconAction}
                      onPress={() => void removeMedia(media)}
                    >
                      <Ionicons name="trash-outline" size={16} color={c.red} />
                    </Pressable>
                  </View>
                ))}
              <Text style={s.footnote}>
                Le direct peut être limité selon le pays et les droits du programme.
              </Text>
            </View>
          ) : null}

          {mediaSource === 'radio' ? (
            <View style={s.mediaList}>
              <Text style={s.detail}>Recherchez une station, puis lancez-la sur la TV.</Text>
              <View style={s.searchRow}>
                <TextInput
                  value={radioQuery}
                  onChangeText={setRadioQuery}
                  onSubmitEditing={searchRadio}
                  returnKeyType="search"
                  maxLength={60}
                  placeholder="France Inter, RTL, Radio Classique…"
                  placeholderTextColor={c.muted}
                  style={[s.input, s.flex]}
                />
                <Pressable
                  disabled={busy || radioQuery.trim().length < 2}
                  style={s.searchButton}
                  onPress={searchRadio}
                >
                  <Ionicons name="search" size={18} color="#fff" />
                </Pressable>
              </View>
              {savedRadio.length ? (
                <>
                  <Text style={s.fieldLabel}>Stations enregistrées</Text>
                  {savedRadio.map((media) => (
                    <View key={media.id} style={s.mediaRow}>
                      {media.artworkUrl ? (
                        <Image source={{ uri: media.artworkUrl }} style={s.mediaThumb} />
                      ) : (
                        <View style={s.mediaPlaceholder}>
                          <Ionicons name="radio-outline" size={18} color={c.accent} />
                        </View>
                      )}
                      <View style={s.flex}>
                        <Text numberOfLines={1} style={s.mediaTitle}>
                          {media.title}
                        </Text>
                        <Text style={s.mediaSubtitle}>Radio</Text>
                      </View>
                      <Pressable
                        accessibilityLabel={`Lire ${media.title}`}
                        disabled={busy || !snapshot?.online}
                        style={s.iconAction}
                        onPress={() => void playMedia(media)}
                      >
                        <Ionicons name="play" size={17} color={c.blue} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Retirer ${media.title}`}
                        disabled={busy}
                        style={s.iconAction}
                        onPress={() => void removeMedia(media)}
                      >
                        <Ionicons name="trash-outline" size={16} color={c.red} />
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}
              {radioResults.length ? (
                radioResults.map((station) => (
                  <View key={`${station.id}-${station.url}`} style={s.mediaRow}>
                    {station.artworkUrl ? (
                      <Image source={{ uri: station.artworkUrl }} style={s.mediaThumb} />
                    ) : (
                      <View style={s.mediaPlaceholder}>
                        <Ionicons name="radio-outline" size={18} color={c.accent} />
                      </View>
                    )}
                    <View style={s.flex}>
                      <Text numberOfLines={1} style={s.mediaTitle}>
                        {station.name}
                      </Text>
                      <Text style={s.mediaSubtitle}>
                        {station.country || 'France'}
                        {station.bitrate ? ` · ${station.bitrate} kb/s` : ''}
                      </Text>
                    </View>
                    <Pressable
                      disabled={busy || !snapshot?.online}
                      style={s.iconAction}
                      onPress={() => void playRadio(station)}
                    >
                      <Ionicons name="play" size={17} color={c.blue} />
                    </Pressable>
                  </View>
                ))
              ) : !savedRadio.length ? (
                <Text style={s.emptyText}>Recherchez une station pour commencer.</Text>
              ) : null}
            </View>
          ) : null}

          {mediaSource === 'podcasts' ? (
            <View style={s.mediaList}>
              <Text style={s.detail}>
                Recherchez une émission et choisissez un épisode à écouter.
              </Text>
              <View style={s.searchRow}>
                <TextInput
                  value={podcastQuery}
                  onChangeText={setPodcastQuery}
                  onSubmitEditing={searchPodcasts}
                  returnKeyType="search"
                  placeholder="Nom d’une émission ou d’un sujet"
                  placeholderTextColor={c.muted}
                  style={[s.input, s.flex]}
                />
                <Pressable
                  disabled={busy || podcastQuery.trim().length < 2}
                  style={s.searchButton}
                  onPress={searchPodcasts}
                >
                  <Ionicons name="search" size={18} color="#fff" />
                </Pressable>
              </View>
              {(screenState?.podcasts ?? []).length ? (
                <Text style={s.fieldLabel}>Émissions suivies</Text>
              ) : null}
              {(screenState?.podcasts ?? []).map((podcast) => (
                <View key={podcast.id} style={s.mediaRow}>
                  {podcast.artworkUrl ? (
                    <Image source={{ uri: podcast.artworkUrl }} style={s.mediaThumb} />
                  ) : (
                    <View style={s.mediaPlaceholder}>
                      <Ionicons name="headset-outline" size={18} color={c.accent} />
                    </View>
                  )}
                  <Pressable style={s.flex} onPress={() => togglePodcast(podcast)}>
                    <Text numberOfLines={1} style={s.mediaTitle}>
                      {podcast.title}
                    </Text>
                    <Text style={s.mediaSubtitle}>{podcast.author || 'Podcast suivi'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${selectedPodcast?.id === podcast.id ? 'Masquer' : 'Afficher'} les épisodes de ${podcast.title}`}
                    accessibilityState={{ expanded: selectedPodcast?.id === podcast.id }}
                    style={s.iconAction}
                    onPress={() => togglePodcast(podcast)}
                  >
                    <Ionicons
                      name={selectedPodcast?.id === podcast.id ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={c.muted}
                    />
                  </Pressable>
                </View>
              ))}
              {podcastResults.map((podcast) => (
                <View key={podcast.id} style={s.mediaRow}>
                  {podcast.artworkUrl ? (
                    <Image source={{ uri: podcast.artworkUrl }} style={s.mediaThumb} />
                  ) : (
                    <View style={s.mediaPlaceholder}>
                      <Ionicons name="headset-outline" size={18} color={c.accent} />
                    </View>
                  )}
                  <Pressable style={s.flex} onPress={() => togglePodcast(podcast)}>
                    <Text numberOfLines={1} style={s.mediaTitle}>
                      {podcast.title}
                    </Text>
                    <Text style={s.mediaSubtitle}>
                      {podcast.author || 'Podcast'} · {podcast.episodeCount} épisodes
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${selectedPodcast?.id === podcast.id ? 'Masquer' : 'Afficher'} les épisodes de ${podcast.title}`}
                    accessibilityState={{ expanded: selectedPodcast?.id === podcast.id }}
                    style={s.iconAction}
                    onPress={() => togglePodcast(podcast)}
                  >
                    <Ionicons
                      name={selectedPodcast?.id === podcast.id ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={c.muted}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Suivre ${podcast.title}`}
                    disabled={
                      busy || (screenState?.podcasts ?? []).some((item) => item.id === podcast.id)
                    }
                    style={s.iconAction}
                    onPress={() =>
                      void run(
                        () =>
                          mobileApi
                            .followScreenPodcast(server, token, podcast.id)
                            .then(() => undefined),
                        true,
                      )
                    }
                  >
                    <Ionicons
                      name={
                        (screenState?.podcasts ?? []).some((item) => item.id === podcast.id)
                          ? 'checkmark'
                          : 'add'
                      }
                      size={18}
                      color={c.blue}
                    />
                  </Pressable>
                </View>
              ))}
              {selectedPodcast ? (
                <View style={s.episodeCard}>
                  <Text style={s.subheading}>Épisodes · {selectedPodcast.title}</Text>
                  {podcastEpisodes.length ? (
                    podcastEpisodes.map((episode) => (
                      <View key={episode.id} style={s.episodeRow}>
                        <View style={s.flex}>
                          <Text numberOfLines={2} style={s.mediaTitle}>
                            {episode.title}
                          </Text>
                          <Text style={s.mediaSubtitle}>
                            {episode.publishedAt
                              ? new Date(episode.publishedAt).toLocaleDateString('fr-FR')
                              : 'Épisode récent'}
                            {episode.durationSeconds
                              ? ` · ${formatDuration(episode.durationSeconds)}`
                              : ''}
                          </Text>
                        </View>
                        <Pressable
                          disabled={busy || !snapshot?.online}
                          style={s.iconAction}
                          onPress={() => void playPodcastEpisode(selectedPodcast, episode)}
                        >
                          <Ionicons name="play" size={17} color={c.blue} />
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={s.emptyText}>Aucun épisode disponible pour le moment.</Text>
                  )}
                </View>
              ) : null}
            </View>
          ) : null}

          {mediaSource === 'youtube' ? (
            <View style={s.mediaList}>
              <Text style={s.detail}>
                Ajoutez un lien vidéo YouTube pour le retrouver dans vos médias.
              </Text>
              <TextInput
                value={youtubeTitle}
                onChangeText={setYoutubeTitle}
                maxLength={120}
                placeholder="Titre (facultatif)"
                placeholderTextColor={c.muted}
                style={s.input}
              />
              <TextInput
                value={youtubeUrl}
                onChangeText={setYoutubeUrl}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://youtu.be/…"
                placeholderTextColor={c.muted}
                style={s.input}
              />
              <Pressable
                disabled={busy || !youtubeIsValid}
                style={[s.primaryButton, (busy || !youtubeIsValid) && s.disabledButton]}
                onPress={addYoutube}
              >
                <Ionicons name="logo-youtube" size={18} color="#fff" />
                <Text style={s.primaryButtonText}>
                  {snapshot?.online ? 'Ajouter et lancer' : 'Ajouter à mes médias'}
                </Text>
              </Pressable>
              {savedYoutube.length ? (
                <>
                  <Text style={s.fieldLabel}>Vidéos enregistrées</Text>
                  {savedYoutube.map((media) => (
                    <View key={media.id} style={s.mediaRow}>
                      <View style={s.mediaPlaceholder}>
                        <Ionicons name="logo-youtube" size={18} color="#D94942" />
                      </View>
                      <View style={s.flex}>
                        <Text numberOfLines={1} style={s.mediaTitle}>
                          {media.title}
                        </Text>
                        <Text style={s.mediaSubtitle}>YouTube</Text>
                      </View>
                      <Pressable
                        accessibilityLabel={`Lire ${media.title}`}
                        disabled={busy || !snapshot?.online}
                        style={s.iconAction}
                        onPress={() => void playMedia(media)}
                      >
                        <Ionicons name="play" size={17} color={c.blue} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Retirer ${media.title}`}
                        disabled={busy}
                        style={s.iconAction}
                        onPress={() => void removeMedia(media)}
                      >
                        <Ionicons name="trash-outline" size={16} color={c.red} />
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {upcomingContent.length ? (
        <View style={s.card}>
          <Text style={s.subheading}>Prochaines diffusions</Text>
          {upcomingContent.map((item) => (
            <View key={item.id} style={s.scheduledRow}>
              <View style={s.flex}>
                <Text numberOfLines={1} style={s.mediaTitle}>
                  {item.title}
                </Text>
                <Text style={s.mediaSubtitle}>
                  {new Date(item.scheduledAt).toLocaleString('fr-FR', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {item.kind === 'message' ? 'Message' : 'Photo'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Annuler la programmation de ${item.title}`}
                disabled={busy}
                style={s.iconAction}
                onPress={() =>
                  void run(
                    () =>
                      mobileApi
                        .cancelScheduledScreenContent(server, token, item.id)
                        .then(() => undefined),
                    true,
                  )
                }
              >
                <Ionicons name="trash-outline" size={16} color={c.red} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(activePicker)}
        onRequestClose={() => setActivePicker(null)}
      >
        <View style={s.pickerOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer le sélecteur de date"
            style={s.pickerBackdrop}
            onPress={() => setActivePicker(null)}
          />
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Pressable onPress={() => setActivePicker(null)} style={s.pickerHeaderButton}>
                <Text style={s.pickerCancel}>Annuler</Text>
              </Pressable>
              <Text style={s.pickerTitle}>
                {activePicker?.mode === 'date' ? 'Choisir la date' : 'Choisir l’heure'}
              </Text>
              <Pressable onPress={confirmPicker} style={s.pickerHeaderButton}>
                <Text style={s.pickerConfirm}>Valider</Text>
              </Pressable>
            </View>
            {activePicker ? (
              <MobileDateTimePicker
                value={pickerDraft}
                mode={activePicker.mode}
                is24Hour
                locale="fr-FR"
                themeVariant="light"
                minuteInterval={5}
                onChange={(_event, selected) => {
                  if (selected) setPickerDraft(selected);
                }}
                style={s.picker}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function resolveScreenMediaUrl(url: string, base: string) {
  const uri = url.startsWith('http') ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  return uri;
}

function isPrivateScreenMedia(uri: string, base: string) {
  try {
    const mediaUrl = new URL(uri);
    return (
      mediaUrl.origin === new URL(base).origin &&
      mediaUrl.pathname.startsWith('/api/v1/screen-media/')
    );
  } catch {
    return uri.startsWith('/api/v1/screen-media/');
  }
}

function ScreenMediaImage({
  url,
  base,
  token,
  style,
  resizeMode,
}: {
  url: string;
  base: string;
  token: string;
  style: React.ComponentProps<typeof Image>['style'];
  resizeMode: React.ComponentProps<typeof Image>['resizeMode'];
}) {
  const uri = resolveScreenMediaUrl(url, base);
  const isPrivate = isPrivateScreenMedia(uri, base);
  const [webSource, setWebSource] = useState<
    { uri: string; token: string; objectUrl: string } | undefined
  >(undefined);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isPrivate) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    void fetch(uri, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Photo indisponible (${response.status}).`);
        return response.blob();
      })
      .then((blob) => {
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setWebSource({ uri, token, objectUrl: nextObjectUrl });
      })
      .catch(() => {
        // The card keeps its placeholder color while the protected image is unavailable.
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPrivate, token, uri]);

  const source =
    Platform.OS === 'web' && isPrivate
      ? webSource?.uri === uri && webSource.token === token
        ? { uri: webSource.objectUrl }
        : undefined
      : isPrivate
        ? { uri, headers: { Authorization: `Bearer ${token}` } }
        : { uri };
  return <Image source={source} style={style} resizeMode={resizeMode} />;
}

function ScheduleControls({
  value,
  onDate,
  onTime,
  onClear,
  disabled,
}: {
  value: Date | null;
  onDate: () => void;
  onTime: () => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const scheduleLabel = value
    ? value.toLocaleString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Choisir une date et une heure';
  return (
    <View style={s.schedulePanel}>
      <View style={s.flex}>
        <Text style={s.fieldLabel}>Diffusion programmée</Text>
        <Text style={s.detail}>{scheduleLabel}</Text>
      </View>
      <View style={s.scheduleActions}>
        <Pressable
          accessibilityLabel="Choisir la date"
          disabled={disabled}
          style={s.scheduleAction}
          onPress={onDate}
        >
          <Ionicons name="calendar-outline" size={15} color={c.blue} />
          <Text style={s.scheduleActionText}>Date</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Choisir l’heure"
          disabled={disabled}
          style={s.scheduleAction}
          onPress={onTime}
        >
          <Ionicons name="time-outline" size={15} color={c.blue} />
          <Text style={s.scheduleActionText}>Heure</Text>
        </Pressable>
        {value ? (
          <Pressable
            accessibilityLabel="Retirer la programmation"
            disabled={disabled}
            style={s.clearScheduleAction}
            onPress={onClear}
          >
            <Ionicons name="close" size={16} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes.toString().padStart(2, '0')}` : `${minutes} min`;
}

function createUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random % 4) + 8).toString(16);
  });
}

const s = StyleSheet.create({
  container: { gap: 10 },
  flex: { flex: 1 },
  mainTabs: {
    padding: 5,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.line,
  },
  mainTab: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  mainTabActive: { backgroundColor: c.blue },
  mainTabText: { color: c.muted, fontSize: 9, fontWeight: '800' },
  mainTabTextActive: { color: '#fff' },
  card: {
    padding: 13,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    gap: 11,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  headingGreen: { backgroundColor: c.paleGreen },
  headingAmber: { backgroundColor: c.paleAmber },
  title: { color: c.navy, fontFamily: 'Georgia', fontSize: 18 },
  detail: { color: c.muted, fontSize: 10, lineHeight: 15 },
  pickButton: {
    minHeight: 60,
    paddingHorizontal: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F7F6F2',
  },
  pickTitle: { color: c.navy, fontSize: 11, fontWeight: '800' },
  pickDetail: { marginTop: 3, color: c.muted, fontSize: 9 },
  photoDraft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  photoPreview: { width: 54, height: 54, borderRadius: 11, backgroundColor: c.paleBlue },
  input: {
    minHeight: 43,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    fontSize: 11,
    backgroundColor: '#fff',
  },
  messageInput: { minHeight: 95, textAlignVertical: 'top' },
  counter: { color: c.muted, textAlign: 'right', fontSize: 9 },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.blue,
  },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  secondaryButton: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.paper,
  },
  secondaryButtonText: { color: c.navy, fontSize: 10, fontWeight: '800' },
  subheadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subheading: { color: c.navy, fontSize: 12, fontWeight: '900' },
  speedControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roundButton: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  speedValue: { minWidth: 36, color: c.navy, textAlign: 'center', fontSize: 10, fontWeight: '900' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  photoCard: {
    width: '48%',
    padding: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: '#fff',
    gap: 6,
  },
  libraryPhoto: { width: '100%', aspectRatio: 1, borderRadius: 9, backgroundColor: c.paleBlue },
  photoTitle: { minHeight: 28, color: c.navy, fontSize: 9, fontWeight: '800' },
  photoActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F0EC',
  },
  emptyText: { paddingVertical: 9, color: c.muted, textAlign: 'center', fontSize: 10 },
  fieldLabel: { color: c.navy, fontSize: 10, fontWeight: '900' },
  chipRow: { alignItems: 'center', gap: 7 },
  favoriteChip: {
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: c.paleAmber,
  },
  favoriteEmoji: { fontSize: 13 },
  favoriteText: { color: c.navy, fontSize: 9, fontWeight: '800' },
  messageChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    justifyContent: 'center',
    backgroundColor: '#EEEBE5',
  },
  messageChipActive: { backgroundColor: c.blue },
  messageChipText: { color: c.navy, fontSize: 9, fontWeight: '800' },
  messageChipTextActive: { color: '#fff' },
  addMessageChip: {
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: c.paleBlue,
  },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  emojiButton: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F0EA',
  },
  emojiText: { fontSize: 14 },
  messageTiming: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 7 },
  secondsInput: {
    width: 54,
    height: 38,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: '#fff',
  },
  actionRow: { flexDirection: 'row', gap: 8 },
  schedulePanel: {
    minHeight: 52,
    padding: 8,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F6F4EF',
  },
  scheduleActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scheduleAction: {
    minHeight: 34,
    paddingHorizontal: 7,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: c.paleBlue,
  },
  scheduleActionText: { color: c.blue, fontSize: 9, fontWeight: '800' },
  clearScheduleAction: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEEBE5',
  },
  sourceTabs: { gap: 7, paddingVertical: 2 },
  sourceTab: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEEBE5',
  },
  sourceTabActive: { backgroundColor: c.paleBlue },
  sourceTabText: { color: c.muted, fontSize: 9, fontWeight: '800' },
  sourceTabTextActive: { color: c.blue },
  mediaList: { gap: 9 },
  mediaRow: {
    minHeight: 58,
    padding: 7,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F6F4EF',
  },
  mediaThumb: { width: 43, height: 43, borderRadius: 9, backgroundColor: c.paleBlue },
  mediaPlaceholder: {
    width: 43,
    height: 43,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  channelBrand: {
    width: 43,
    height: 43,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelBrandArte: { backgroundColor: '#FFF4EC' },
  channelBrandRmc: { backgroundColor: '#19365B' },
  channelBrandText: { fontWeight: '900' },
  channelBrandTextArte: { color: '#F0673C', fontSize: 21, letterSpacing: -2 },
  channelBrandTextRmc: { color: '#fff', fontSize: 12, letterSpacing: -0.3 },
  mediaTitle: { color: c.navy, fontSize: 10, fontWeight: '900' },
  mediaSubtitle: { marginTop: 3, color: c.muted, fontSize: 9 },
  sourceCard: {
    minHeight: 64,
    padding: 8,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F6F4EF',
  },
  playButton: {
    minHeight: 35,
    paddingHorizontal: 9,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.blue,
  },
  playButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  footnote: { color: c.muted, fontSize: 9, lineHeight: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchButton: {
    width: 43,
    height: 43,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  episodeCard: { padding: 9, borderRadius: 12, gap: 7, backgroundColor: '#F6F4EF' },
  episodeRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  scheduledRow: {
    minHeight: 58,
    padding: 7,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F6F4EF',
  },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end' },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 22, 36, 0.38)' },
  pickerSheet: {
    paddingBottom: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: c.paper,
  },
  pickerHeader: {
    minHeight: 54,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerHeaderButton: { minWidth: 62, paddingVertical: 9 },
  pickerCancel: { color: c.muted, fontSize: 12 },
  pickerTitle: { color: c.navy, fontSize: 13, fontWeight: '800' },
  pickerConfirm: { color: c.blue, textAlign: 'right', fontSize: 12, fontWeight: '900' },
  picker: { height: 210 },
  error: { padding: 9, borderRadius: 10, color: c.red, backgroundColor: c.paleAmber, fontSize: 10 },
});
