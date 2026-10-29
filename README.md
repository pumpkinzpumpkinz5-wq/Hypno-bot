# Hypno-bot
Hypno maker

## Run
Open `index.html` in Chrome or Edge, or serve the folder with any static server.

For live sessions, run the included server (Node 18+, no dependencies):

```
node server.js                  # http://127.0.0.1:8080
HOST=0.0.0.0 PORT=8080 node server.js   # let other devices on your network join
```

Press **Go live**, then send the link it copies (`yoursite/<room>`). Viewers open it and click Join.
Type a room name first to get the same link every time; reloading your page and pressing Go live again takes the room back.
Files from your computer are uploaded to the server (in memory) so viewers get them too.
For viewers outside your network, the server has to be reachable from the internet (hosting or a tunnel).

## Reddit
Reddit only answers logged-in users, so it needs a one-time setup:
1. At https://www.reddit.com/prefs/apps create an app of type **installed app**.
2. Set its redirect URI to the address of the folder the app is served from, e.g. `http://localhost:8080/`.
3. Put the app's client ID in `REDDIT_CLIENT_ID` at the top of `index.html`.

The first "Add from Reddit" opens a Reddit login window. The login lasts about an hour.
