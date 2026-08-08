# Cave Paintings

## Run

```powershell
npx --yes serve -l 8888
```

Open http://localhost:8888

Or just open `index.html` in a browser.

## Ngrok

```powershell
copy ngrok.env.example ngrok.env
# edit ngrok.env — set NGROK_URL to your reserved domain
.\run-ngrok.bat
```

`ngrok.env` is gitignored; only `ngrok.env.example` is committed.
