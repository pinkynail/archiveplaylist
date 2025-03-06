const { google } = require("googleapis");
const credentials = require("./credentials.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);

async function authorize() {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const code =
    "4/0AQSTgQFbrOAVhjFpuF95FHC4ESvE9l7RVvb-1E8TmF8DqqV8YrFpPNPQeclWzp0a8aB4DQ"; // Вставь код после авторизации
  const { tokens } = await oAuth2Client.getToken(code);
  console.log("Refresh token:", tokens.refresh_token);
}

authorize();
