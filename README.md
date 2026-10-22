<div align="center">

# 🍿 Plex Re-View

**Your year on Plex, re-viewed.** A Spotify Wrapped-style recap for everyone on your Plex server,<br>
with a cinema-themed scrolling page, a server leaderboard, data stats and a shareable card.

<img src="docs/screenshots/review-intro.jpg" alt="Plex Re-View intro screen" width="900">

</div>

---

Your users sign in with their own **Plex account**, the stats come from **[Tautulli](https://tautulli.com/)**, and the whole thing runs as **one small Docker container** that you can deploy from Portainer in a couple of minutes. No database, no build step, no external dependencies.

> Screenshots in this README use the built-in demo with made-up data and placeholder posters. On a real server the posters are your actual library artwork.

## ✨ Features

### Your Re-View
One long page that comes alive as you scroll: sections slide, zoom and fade in, numbers count up and the colours shift from section to section. All with a sense of humour.

- **Total watch time** in hours and days, plus a breakdown of episodes, shows and movies
- **Year vs. last year**, comparing the same period while the year is still running
- **Top show and top movie** with real posters, plus your top 5 of each
- **Daily rhythm and seasons**: your peak hour, favourite day and busiest month
- **Biggest binge day** and **longest streak**
- **First and most recent play** of the year
- **Trusty sidekick**: the device you used most
- **Transcode shame**: how often your devices made the server sweat
- **The graveyard**: movies you quit before halfway
- **Server leaderboard rank** and your share of everything watched
- **Taste twin**: the person on your server whose taste matches yours best
- **Viewer personality**: Night Owl, Binge Machine, Loyalist, Cinephile and more
- **Save my card 📸**: a 1080×1920 image of your year, ready for WhatsApp or Instagram stories

### Leaderboard
Everyone on the server ranked by hours watched, the **top 25 shows** and **top 25 movies** with how many people watched them, and a **Transcode shame** ranking.

### Data
How much the server has streamed to people **outside your home**, in total and per year (in MB, GB, TB and PB), with fun facts ("that's 245 years over a 56k modem") and **server records**: longest single session, most people watching at once, total plays and new movies and shows added this year.

### Admin
Server totals, watch time per month, devices, every user (including the ones who never press play) and a button to open anyone's Re-View.

### And also
- 🎬 Dark cinema look: film strips with your library's posters, rows of seats and film grain
- 📱 Works on phones and desktops
- 🔐 Plex sign-in. Only people who have access to your server (according to Tautulli) can get in
- 🗓️ Look back at previous years with the year picker
- ♿ Respects "reduce motion" settings

## 📸 Screenshots

| | |
|---|---|
| <img src="docs/screenshots/review-total.jpg" alt="Total watch time"> | <img src="docs/screenshots/review-top-show.jpg" alt="Your number one show"> |
| <img src="docs/screenshots/review-rhythm.jpg" alt="Daily rhythm chart"> | <img src="docs/screenshots/review-taste-twin.jpg" alt="Taste twin"> |
| <img src="docs/screenshots/review-personality.jpg" alt="Viewer personality"> | <img src="docs/screenshots/leaderboard.jpg" alt="Leaderboard"> |
| <img src="docs/screenshots/data.jpg" alt="Data streamed per year"> | <img src="docs/screenshots/data-fun-facts.jpg" alt="Data per year and fun facts"> |
| <img src="docs/screenshots/admin.jpg" alt="Admin page"> | |

<table>
  <tr>
    <td><img src="docs/screenshots/mobile-intro.jpg" alt="Mobile intro" width="230"></td>
    <td><img src="docs/screenshots/mobile-top-show.jpg" alt="Mobile top show" width="230"></td>
    <td><img src="docs/screenshots/mobile-summary.jpg" alt="Mobile summary" width="230"></td>
    <td><img src="docs/screenshots/share-card.png" alt="Shareable card" width="230"></td>
  </tr>
  <tr>
    <td align="center">On a phone</td>
    <td align="center">Scroll-in sections</td>
    <td align="center">Summary</td>
    <td align="center">The share card</td>
  </tr>
</table>

## 🚀 Deploy with Portainer

**You need:** Docker with Portainer, a Plex server, and Tautulli connected to it. For the Data page you also need Plex Pass.

1. In Portainer go to **Stacks → Add stack → Repository**.
2. Repository URL: `https://github.com/Sietsevdm/Plex_Re-View`, compose path: `docker-compose.yml`.
3. Under **Environment variables**, add at least `TAUTULLI_URL`, `TAUTULLI_API_KEY` and `SESSION_SECRET` (see Configuration below).
4. Click **Deploy the stack** and open `http://<your-docker-host>:8080`.

Portainer builds the image from the repo. To update later, use **Pull and redeploy** on the stack.

### Or with plain Docker Compose

```bash
git clone https://github.com/Sietsevdm/Plex_Re-View.git
cd Plex_Re-View
cp .env.example .env   # then fill in your values
docker compose up -d --build
```

## ⚙️ Configuration

| Variable | Required | What it does |
|---|---|---|
| `TAUTULLI_URL` | ✅ | How the container reaches Tautulli, e.g. `http://192.168.1.10:8181`. Include a base URL such as `/tautulli` if you use one. In the same Docker network `http://tautulli:8181` works. |
| `TAUTULLI_API_KEY` | ✅ | Tautulli → Settings → Web Interface → API key |
| `SESSION_SECRET` | ✅ | Any long random string. Signs the login cookies; changing it logs everyone out. |
| `TZ` | | Time zone for peak hours, days and streaks. Default `Europe/Amsterdam`. |
| `PORT` | | Port on the Docker host. Default `8080`. |
| `PLEX_URL` | | Your Plex server, e.g. `http://192.168.1.10:32400`. Enables the Data page and "added this year". |
| `PLEX_TOKEN` | | The server owner's [X-Plex-Token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). Stays on the server, never sent to browsers. |
| `ADMIN_USERS` | | Extra admins: Plex usernames, comma-separated. The server owner is always admin. |

**Behind a reverse proxy with HTTPS?** Make sure it sends `X-Forwarded-Proto: https` so the login cookie is marked `Secure`.

## 🔍 How it works

```
Browser ──► Plex Re-View (Node, one container) ──► Tautulli API   (watch history, users, posters)
   │                    │                     └──► Plex server     (bandwidth stats, library counts; optional)
   └── signs in at plex.tv; the server checks the account is a user in Tautulli
```

- **`public/index.html`**: the entire frontend in one HTML5 file (HTML, CSS and plain JavaScript).
- **`server.js`**: a small Node server with **zero npm dependencies**. It handles the Plex sign-in, keeps your API key and token server-side, proxies posters and caches Tautulli answers for 10 minutes.
- **`stats.js`**: turns raw watch history into the yearly stats. Covered by tests (`npm test`).

### Privacy
- Users sign in with Plex. Only accounts that exist in Tautulli (people you share your server with) get in.
- Your Tautulli API key and Plex token never reach the browser. Posters go through the app's image proxy.
- Everyone signed in can see the leaderboard, including names, hours, favourite titles and taste twins. Data totals are for the whole server, never per person.
- Sessions are signed cookies; nothing is stored on disk.

## 🧪 Try it locally

The demo runs a fake Tautulli and Plex with made-up users, plays and posters. No real server needed:

```bash
npm run demo
```

Open http://localhost:8181 and pick who to log in as (the demo skips the Plex sign-in; Sietse is the admin). The demo is not included in the Docker image.

Against your real Tautulli:

```bash
TAUTULLI_URL=http://192.168.1.10:8181 TAUTULLI_API_KEY=xxx SESSION_SECRET=dev node server.js
```

Requires Node 20 or newer. Run the tests with `npm test`.

## 🙏 Inspiration

Plex Re-View was inspired by these great projects:

- [plex-unwrapped](https://github.com/mihavidakovic/plex-unwrapped) by mihavidakovic
- [plex-rewind](https://github.com/RaunoT/plex-rewind) by RaunoT
- [Wrapperr](https://github.com/aunefyren/wrapperr) by aunefyren

---

<sub>Not affiliated with or endorsed by Plex Inc. or Tautulli. Plex is a trademark of Plex Inc.</sub>
