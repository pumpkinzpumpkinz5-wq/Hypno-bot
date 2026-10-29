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
"Add from Reddit" works without setup by reading redditp's public archive: popular subreddits only, their Hot page (25 posts), updated every few weeks.

For live results, `server.js` can sign in to Reddit with its own app instead (Reddit now has to approve new apps, see its Responsible Builder Policy).
One-time setup:
1. At https://www.reddit.com/prefs/apps click "create another app", pick **script**, any name, and any redirect URI (e.g. `http://localhost:8080`; it isn't used).
2. Start the server with the app's ID (shown under its name) and secret:

```
REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... node server.js
```

With these set, the Hot/Top/New choice shows and results are live.
