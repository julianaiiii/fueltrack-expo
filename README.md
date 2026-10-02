# FuelTrack Native (Expo)

Eine echte React-Native/Expo-Version von FuelTrack, ohne WebView.

## Enthalten

- Tages-Dashboard mit Kalorien und Makros
- Historie der letzten 7 Tage
- Frühstück, Mittagessen, Abendessen und Snacks
- Open Food Facts Produktsuche
- Echter Barcode-Scanner über `expo-camera`
- Nach erkanntem Barcode automatische Produktsuche
- Portions-/Scheiben-/Stück-Modus und Umschaltung auf Gramm
- automatische Berechnung von Kalorien, Protein, Kohlenhydraten und Fett nach Gramm
- eigene Produkte speichern und später wiederverwenden
- Speichern eigener Produkte standardmäßig **aus**
- persönliche Kalorien-/Makroziele
- Dark Mode
- lokale Speicherung über AsyncStorage

## Auf dem iPhone mit Expo Go starten

1. Installiere Node.js auf deinem PC/Mac.
2. Entpacke diesen Ordner und öffne ein Terminal darin.
3. Installiere die Pakete:

```bash
npm install
npx expo install --fix
```

4. Starte Expo:

```bash
npx expo start
```

5. Installiere **Expo Go** auf dem iPhone und melde dich mit deinem Expo-Konto an.
6. Falls die Expo CLI danach fragt, melde dich am Rechner mit demselben Konto an:

```bash
npx expo login
```

7. Scanne den QR-Code aus dem Terminal mit Expo Go.

Wenn dein iPhone den Rechner im WLAN nicht erreicht:

```bash
npx expo start --tunnel
```

## Apple Health

Apple Health / HealthKit ist absichtlich noch nicht in dieser Expo-Go-Version enthalten. HealthKit braucht nativen Code und damit einen **Expo Development Build**. Die App kann später dafür erweitert werden.

## Account-Sync

Die bisherige AppDeploy-Web-Authentifizierung wurde nicht als React-Native-SDK übernommen. Diese Expo-Version speichert Daten aktuell lokal. Für echte Geräte-Synchronisierung sollte als nächster Schritt eine native Auth-/Backend-Schicht ergänzt werden (z. B. Supabase/Firebase/eigenes API-Backend).
