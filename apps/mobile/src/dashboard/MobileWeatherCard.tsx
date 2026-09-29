import { Ionicons } from '@expo/vector-icons';
import type { ScreenSnapshot } from '@michel/contracts';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileApi, type WeatherCity } from '../api';
import type { SavedServer } from '../discovery/types';

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
  paleBlue: '#E8F0F3',
  red: '#B74747',
};

type Locale = 'fr' | 'en';

export function MobileWeatherCard({
  server,
  token,
  locale,
  snapshot,
  onChanged,
}: {
  server: SavedServer;
  token: string;
  locale: Locale;
  snapshot?: ScreenSnapshot;
  onChanged: () => void;
}) {
  const fr = locale === 'fr';
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [weatherQuery, setWeatherQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [weatherSearch, setWeatherSearch] = useState<WeatherCity[]>([]);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const weatherCity = snapshot?.weather?.city ?? snapshot?.state.settings.weatherCity ?? '';
  const weather = snapshot?.weather;
  const canManage = Boolean(snapshot?.grant.administer);

  useEffect(() => {
    if (
      !weatherOpen ||
      !canManage ||
      weatherQuery.trim().length < 2 ||
      weatherQuery.trim() === selectedCity
    ) {
      setWeatherSearch([]);
      setWeatherBusy(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setWeatherBusy(true);
      void mobileApi
        .weatherCities(server, token, weatherQuery.trim())
        .then((cities) => {
          if (active) setWeatherSearch(cities);
        })
        .catch(() => {
          if (active)
            setNotice(
              fr
                ? 'La recherche de villes est momentanément indisponible.'
                : 'City search is temporarily unavailable.',
            );
        })
        .finally(() => {
          if (active) setWeatherBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canManage, fr, selectedCity, server.id, token, weatherOpen, weatherQuery]);

  const openWeather = () => {
    setNotice('');
    setWeatherQuery(weatherCity);
    setSelectedCity(weatherCity);
    setWeatherOpen(true);
  };

  const saveWeather = async () => {
    if (!snapshot?.grant.administer || !selectedCity || saving) return;
    setSaving(true);
    setNotice('');
    try {
      await mobileApi.updateScreenSettings(server, token, {
        ...snapshot.state.settings,
        weatherCity: selectedCity,
      });
      setWeatherOpen(false);
      onChanged();
    } catch {
      setNotice(
        fr ? 'La météo n’a pas pu être enregistrée.' : 'The weather settings could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const badge = !snapshot
    ? fr
      ? 'Chargement…'
      : 'Loading…'
    : weather
      ? fr
        ? 'Disponible'
        : 'Available'
      : weatherCity
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : fr
          ? 'À configurer'
          : 'Set up';

  return (
    <>
      <View style={s.card}>
        <View style={s.header}>
          <View style={s.headerIcon}>
            <Ionicons name="partly-sunny-outline" size={19} color={c.blue} />
          </View>
          <View style={s.flex}>
            <Text style={s.eyebrow}>{fr ? 'MÉTÉO DU LOGEMENT' : 'HOME WEATHER'}</Text>
            <Text style={s.title}>{fr ? 'Météo' : 'Weather'}</Text>
          </View>
          <Text style={[s.badge, !weather && s.badgeMuted]}>{badge}</Text>
        </View>

        {weatherCity ? (
          <View style={s.summary}>
            <View style={s.weatherIcon}>
              <Ionicons name={weatherIcon(weather?.weatherCode ?? 0)} size={25} color={c.accent} />
            </View>
            <View style={s.flex}>
              <Text style={s.temperature}>
                {weather ? `${Math.round(weather.temperature)}°C` : '—'}
              </Text>
              <Text style={s.city}>{weatherCity}</Text>
              <Text style={s.body}>
                {weather
                  ? weatherText(weather.weatherCode, fr)
                  : fr
                    ? 'Prévisions indisponibles pour le moment.'
                    : 'Forecast is unavailable right now.'}
              </Text>
              {weather?.minimum != null && weather.maximum != null ? (
                <Text style={s.caption}>
                  {fr ? 'Mini' : 'Low'} {Math.round(weather.minimum)}° · {fr ? 'Maxi' : 'High'}{' '}
                  {Math.round(weather.maximum)}°
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={s.body}>
            {fr
              ? 'Choisissez une ville pour afficher les prévisions météo ici.'
              : 'Choose a city to show the weather forecast here.'}
          </Text>
        )}

        <Text style={s.caption}>
          {fr
            ? 'La ville choisie sert aussi à la météo affichée sur la télévision.'
            : 'The selected city is also used for the weather shown on the TV.'}
        </Text>

        {canManage ? (
          <Pressable style={s.configureButton} onPress={openWeather}>
            <Ionicons name="pencil-outline" size={16} color={c.blue} />
            <Text style={s.configureLabel}>
              {weatherCity
                ? fr
                  ? 'Changer de ville'
                  : 'Change city'
                : fr
                  ? 'Configurer la météo'
                  : 'Set up weather'}
            </Text>
          </Pressable>
        ) : (
          <Text style={s.caption}>
            {fr
              ? 'La configuration de la ville est réservée à un administrateur.'
              : 'Only an administrator can change the weather location.'}
          </Text>
        )}
      </View>

      <Modal
        visible={weatherOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setWeatherOpen(false)}
      >
        <View style={s.modalShell}>
          <View style={s.modalHeader}>
            <View>
              <Text style={s.eyebrow}>
                {fr ? 'MÉTÉO DU LOGEMENT ET DE LA TV' : 'HOME AND TV WEATHER'}
              </Text>
              <Text style={s.modalTitle}>{fr ? 'Choisir une ville' : 'Choose a city'}</Text>
            </View>
            <Pressable style={s.close} onPress={() => setWeatherOpen(false)}>
              <Ionicons name="close" size={22} color={c.navy} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={s.body}>
              {fr
                ? 'La ville choisie met également à jour la météo affichée sur la télévision.'
                : 'The selected city also updates the weather shown on the TV.'}
            </Text>
            <TextInput
              style={s.input}
              autoFocus
              value={weatherQuery}
              onChangeText={(value) => {
                setWeatherQuery(value);
                setSelectedCity('');
                setNotice('');
              }}
              placeholder={fr ? 'Ex. Orléans, Tours…' : 'E.g. Orléans, Tours…'}
              placeholderTextColor="#8b9299"
            />
            {weatherBusy ? <Text style={s.body}>{fr ? 'Recherche…' : 'Searching…'}</Text> : null}
            {weatherSearch.map((city) => (
              <Pressable
                key={`${city.name}-${city.latitude}`}
                style={s.cityRow}
                onPress={() => {
                  setWeatherQuery(city.name);
                  setSelectedCity(city.name);
                  setWeatherSearch([]);
                }}
              >
                <Ionicons name="location-outline" size={18} color={c.accent} />
                <View style={s.flex}>
                  <Text style={s.cityResult}>{city.name}</Text>
                  <Text style={s.caption}>{city.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.muted} />
              </Pressable>
            ))}
            {notice ? <Text style={s.notice}>{notice}</Text> : null}
            <Pressable
              disabled={!selectedCity || saving}
              style={[s.saveButton, (!selectedCity || saving) && s.disabled]}
              onPress={() => void saveWeather()}
            >
              <Text style={s.saveLabel}>
                {saving
                  ? fr
                    ? 'Enregistrement…'
                    : 'Saving…'
                  : weatherCity
                    ? fr
                      ? 'Mettre à jour'
                      : 'Update'
                    : fr
                      ? 'Configurer'
                      : 'Set up'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function weatherIcon(code: number): React.ComponentProps<typeof Ionicons>['name'] {
  if (code === 0) return 'sunny-outline';
  if (code <= 2) return 'partly-sunny-outline';
  if ([45, 48].includes(code)) return 'cloud-outline';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow-outline';
  if (code >= 95) return 'thunderstorm-outline';
  return 'rainy-outline';
}

function weatherText(code: number, fr: boolean) {
  if (code === 0) return fr ? 'Ciel dégagé' : 'Clear sky';
  if (code <= 2) return fr ? 'Éclaircies' : 'Partly cloudy';
  if (code === 3) return fr ? 'Nuageux' : 'Cloudy';
  if ([45, 48].includes(code)) return fr ? 'Brouillard' : 'Fog';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return fr ? 'Neige' : 'Snow';
  if (code >= 95) return fr ? 'Orage' : 'Thunderstorm';
  return fr ? 'Pluie' : 'Rain';
}

const s = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  flex: { flex: 1 },
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { marginTop: 4, color: c.navy, fontSize: 13, fontWeight: '900' },
  badge: {
    maxWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
    borderRadius: 12,
    color: c.green,
    backgroundColor: c.paleGreen,
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
  },
  badgeMuted: { color: c.accent, backgroundColor: c.paleBlue },
  summary: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  weatherIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  temperature: { color: c.navy, fontFamily: 'Georgia', fontSize: 22 },
  city: { color: c.navy, fontSize: 10, fontWeight: '900' },
  body: { marginTop: 12, color: c.muted, fontSize: 10, lineHeight: 16 },
  caption: { marginTop: 5, color: c.muted, fontSize: 8, lineHeight: 13 },
  configureButton: {
    minHeight: 40,
    marginTop: 13,
    paddingHorizontal: 11,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: c.paleBlue,
  },
  configureLabel: { color: c.blue, fontSize: 9, fontWeight: '900' },
  modalShell: { flex: 1, backgroundColor: c.cream },
  modalHeader: {
    minHeight: 74,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { marginTop: 5, color: c.navy, fontSize: 17, fontWeight: '900' },
  close: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  modalContent: { padding: 18, paddingBottom: 32, gap: 12 },
  input: {
    minHeight: 43,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    backgroundColor: '#fff',
    fontSize: 10,
  },
  cityRow: {
    minHeight: 58,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: c.paper,
  },
  cityResult: { color: c.navy, fontSize: 11, fontWeight: '900' },
  notice: { color: c.red, fontSize: 9, lineHeight: 14 },
  saveButton: {
    minHeight: 43,
    marginTop: 5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  saveLabel: { color: '#fff', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
