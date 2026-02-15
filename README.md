how to easily deploy it locally (it works) 

organize the files in this order : 

webrtc-video-call/
├── package.json
├── server.js
├── README.md
└── public/             ← MUST HAVE THIS FOLDER!
    ├── index.html      ← All 3 files go HERE
    ├── style.css       ← inside public/
    └── app.js          ← folder
    
# After organizing files correctly (you should have node js installed)
npm install
npm start
```

You'll see:
```
🚀 WebRTC Signaling Server Started
📡 HTTP Server: http://localhost:3000

open it in 2 tabs :
use the same room code and enjoy !!


to do it online u need to connect it to render.com and change the localhost to the link given by it in the app.js thenn deploy it thru netlify 
