# Board Game Preference Ranking

Mobile-first preference ranking app for Brian and Sarah.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev -- --port 5173
```

Open `http://127.0.0.1:5173`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, create a new project from that repository.
3. Vercel should detect Vite automatically. The included `vercel.json` sets:
   - build command: `npm run build`
   - output directory: `dist`
4. Deploy.

## iPhone Use

1. Open the deployed Vercel URL in Safari on Sarah's iPhone.
2. Press **Import Google Sheet** while online.
3. Tap Safari's share button.
4. Choose **Add to Home Screen**.
5. Use the home screen app for the road trip.

Progress is saved in that iPhone browser/app using `localStorage`. Importing on a laptop does not transfer progress to the phone.

## Google Sheet Access

The sheet must be shared as:

```text
Anyone with the link -> Viewer
```

The app imports game titles and metadata from the public CSV export of the sheet.

## Offline Notes

The app has basic PWA caching, so the installed app shell should keep opening after it has been loaded once. The first import needs internet access. Progress saves continuously on the device.
