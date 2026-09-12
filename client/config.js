// client/config.js
//
// The ONE place in the whole client that knows the server's URL.
// Every other file asks network.js to talk to the server; nothing
// else should ever hardcode a URL.
//
// - While developing on your own computer, leave this as localhost.
// - Once you deploy the backend (Phase 7), change SERVER_URL to the
//   public HTTPS address your host gives you, e.g.
//   'https://your-app-name.onrender.com'

const CONFIG = {
  SERVER_URL: 'http://localhost:3000'
};
