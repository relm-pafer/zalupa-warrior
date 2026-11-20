# Zalupa Warrior

A browser game set in the Cell Block C showers. Pick your inmate (Zen, Riki or Koska), then steer him around the wet floor and grab every bar of soap before it slides out the other side.

The game is one HTML file with its own CSS and JavaScript. The shared leaderboard adds one small serverless function. There is no build step and nothing to install.

![Zalupa Warrior share image](og-image.png)

## How to play

| Input | What it does |
| --- | --- |
| Mouse | He runs to wherever the pointer is |
| Touch | Tap or drag on the floor and he runs there |
| Arrow keys or WASD | Run |
| Space | Start a shift |
| P or Esc | Pause |

- Run into soap to pick it up. Three bars getting away ends the shift.
- Gold soap is worth 5×, and catch streaks raise the multiplier up to ×5.
- Green soap switches on a magnet for 7 seconds: any soap that comes near your inmate gets pulled straight to him.
- Don't step on the roaches. Each one costs a strike.
- The game speeds up every 5 bars caught.

### Mällu, the block boss

At level 5 Mällu sneaks into the showers, and he comes back every 5 levels after you drive him off. He only creeps toward you while your inmate has his back turned; face him and he freezes and pretends to wash. If he gets close he winds up and snaps a wet towel, which costs a strike and knocks you back. Every bar you catch knocks down his health (gold counts triple). Drive him off for a bonus of 500 points per visit, and the next bar is gold.

Your personal best and chosen inmate are saved in the browser's local storage.

### Photo faces

Zen, Riki, Koska and Mällu wear bobblehead photo faces from `faces/`, and their bodies are tinted to match. To swap a face, replace the file with a cut-out framed the same way: a 160×184 WebP with a transparent background, eyes level at y 104 and 40 px apart. The `face` and `skin` settings live in `CHARS` (inmates) and `MALLU_LOOK` (the boss) in `index.html`. Remove `face` and that character goes back to the drawn face.

## Leaderboard

Everyone who plays the deployed game shares one leaderboard.

- The first time a shift ends with points, the shift report asks for a name. After that, every shift with points is saved under that name automatically.
- Each name is ranked by its best shift. The **Leaderboard** button on the start screen shows the full board, with tabs for all inmates or just Zen, Riki or Koska.
- The shift report shows the top five and where you placed. Use **Not you?** there, or the name field on the leaderboard screen, when someone else plays on the same device.
- Every run is also kept in a log (the newest 5,000), not just the best ones.
- If the leaderboard can't be reached, the score is kept on the device and sent the next time the game opens.

The API checks that a score is possible for the number of bars caught and allows 20 saves per minute from one address. Anyone with browser dev tools could still submit a fake score, so treat the board as a friendly one.

### Turn it on in Vercel

The scores live in a free Upstash Redis database that you add through Vercel. Until it's connected, the game works as before and the leaderboard stays hidden.

1. Open the project in Vercel and go to **Storage** (or **Integrations → Browse Marketplace**). Create an **Upstash for Redis** database on the free plan and pick a region near you.
2. Connect the database to this project for Production, Preview and Development. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the project's environment variables.
3. Redeploy: open **Deployments**, choose the latest one and click **Redeploy**, or push a commit. Deployments made before the database was connected don't get the new variables.

Open the game and the **Leaderboard** button appears on the start screen.

To test the function locally with the real database, run `npx vercel env pull .env.local` and then `npx vercel dev`.

### API

| Request | What it does |
| --- | --- |
| `GET /api/scores?board=all&limit=10&me=Riki` | Top names on a board (`all`, `zen`, `riki` or `koska`), plus where `me` stands |
| `POST /api/scores` with `{ "name", "char", "score", "caught" }` | Saves a finished shift and returns its rank |

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

Served this way the leaderboard stays hidden, because there is no API. Use `npx vercel dev` to run the game together with the function.

## Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import this GitHub repository.
2. Leave **Framework Preset** on **Other**. Leave the build command and output directory empty.
3. Click **Deploy**.

Vercel deploys the repository's default branch to production. Every push to that branch redeploys the site, and other branches get preview URLs.

To deploy from a terminal instead:

```bash
npx vercel --prod
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole game: markup, styles and script |
| `api/scores.js` | Leaderboard API: saves shifts and serves the rankings from Upstash Redis |
| `faces/` | Photo faces for the inmates |
| `favicon.svg` | Browser tab icon |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home-screen icons for iPhone and Android |
| `site.webmanifest` | Lets phones add the game to the home screen as a full-screen app |
| `og-image.png` | Preview image shown when the link is shared |
| `vercel.json` | Security headers for the Vercel deployment |
