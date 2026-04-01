# Literature Card Game

A real-time multiplayer web app for the Literature (Canadian Fish) card game. Supports 6 or 8 players in two teams.

## Setup

### 1. Firebase (Required for multiplayer)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** (free Spark plan is sufficient)
3. In your project: go to **Build → Realtime Database → Create Database**
   - Choose any region
   - Start in **Test Mode** (allows reads/writes for 30 days; set up rules after)
4. Go to **Project Settings** → scroll to **Your apps** → click **</>** (Web)
5. Register the app, then copy the `firebaseConfig` values
6. Open `firebase-config.js` and paste your values:

```js
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### 2. Run Locally

Because the app uses ES modules, you need a local HTTP server (not `file://`):

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code: use Live Server extension
```

Then open `http://localhost:8080`.

### 3. Deploy to GitHub Pages

1. Push the repo to GitHub
2. Go to **Settings → Pages**
3. Set source to `main` branch, root folder `/`
4. Your game will be live at `https://yourusername.github.io/literature-game/`

> **Note:** `firebase-config.js` contains your Firebase API key. Firebase API keys for Realtime Database are safe to expose in frontend code — they only identify your project. Protect your data by setting proper [Firebase Security Rules](https://firebase.google.com/docs/database/security) before going public.

### 4. Deploy to AWS (Alternative)

If you prefer AWS over GitHub Pages:

**Option A: S3 + CloudFront (Recommended)**
```bash
aws s3 sync . s3://your-bucket-name --exclude "*.md" --exclude ".git/*"
# Enable static website hosting on the S3 bucket
# (Optional) Put CloudFront in front for HTTPS + CDN
```

**Option B: Amplify**
```bash
# Connect your GitHub repo to AWS Amplify
# It auto-deploys on every push
```

---

## How to Play

### Game Overview
- 2 teams of 3 (6 players) or 2 teams of 4 (8 players)
- 48-card deck (standard deck minus the four 8s)
- 8 "half-suits" of 6 cards each: Low (2–7) and High (9–A) per suit
- Goal: Your team claims more than 4 of the 8 half-suits

### Half-Suits
| Name | Cards |
|------|-------|
| Low Spades | 2♠ 3♠ 4♠ 5♠ 6♠ 7♠ |
| High Spades | 9♠ 10♠ J♠ Q♠ K♠ A♠ |
| Low Hearts | 2♥ 3♥ 4♥ 5♥ 6♥ 7♥ |
| High Hearts | 9♥ 10♥ J♥ Q♥ K♥ A♥ |
| Low Diamonds | 2♦ 3♦ 4♦ 5♦ 6♦ 7♦ |
| High Diamonds | 9♦ 10♦ J♦ Q♦ K♦ A♦ |
| Low Clubs | 2♣ 3♣ 4♣ 5♣ 6♣ 7♣ |
| High Clubs | 9♣ 10♣ J♣ Q♣ K♣ A♣ |

### Asking for Cards
- On your turn, ask **any opponent** for a **specific card**
- You **must** already hold at least one card from that half-suit
- **Hit** (they have it): They give you the card. Your turn continues.
- **Miss** (they don't have it): Turn passes to the player you asked.

### Declaring a Half-Suit
- On your turn, click **Declare Half-Suit**
- Assign all 6 cards of a half-suit to your team members
- **Correct assignment**: Your team scores the half-suit ✓
- **Wrong assignment** (but all cards on your team): Nullified — no one scores ✗
- **Opponent holds any card**: Opposing team scores ✗

### Winning
- Game ends when all 8 half-suits are claimed or nullified
- Team with more half-suits wins (4–4 is a tie)

---

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript (ES Modules)
- **Backend**: Firebase Realtime Database (real-time sync)
- **Deployment**: GitHub Pages or AWS S3/Amplify
- **No build tools required**

## Security Note

Player hands are stored in Firebase and are technically readable by anyone with the room code and DB access. This is fine for playing with trusted friends. For a public deployment, add Firebase Security Rules so players can only read their own hand.

Sample rules for Realtime Database:
```json
{
  "rules": {
    "games": {
      "$roomCode": {
        ".read": true,
        ".write": true,
        "players": {
          "$playerId": {
            "hand": {
              ".read": "auth != null && auth.uid === $playerId"
            }
          }
        }
      }
    }
  }
}
```
