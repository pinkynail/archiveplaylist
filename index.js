const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const session = require("express-session");
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
  }),
);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const credentials = {
  web: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
  },
};
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});
const drive = google.drive({ version: "v3", auth: oAuth2Client });

let archiveFolderIdCache = null;
let playlists = [];
let playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs";

async function initializeArchiveFolder() {
  if (archiveFolderIdCache) return archiveFolderIdCache;
  archiveFolderIdCache = "1opfVlshZHmomjtmdoFnffH7N-sTBAbEB";
  try {
    await drive.files.get({ fileId: archiveFolderIdCache });
  } catch (error) {
    throw new Error("Указанный ID папки недоступен");
  }
  return archiveFolderIdCache;
}

async function loadPlaylistsFromDrive() {
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
    const file = await drive.files.get({
      fileId: playlistsFileId,
      alt: "media",
    });
    playlists = file.data || [];
  } catch (error) {
    playlists = [];
  }
}

async function savePlaylistsToDrive() {
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
    const fileMetadata = {
      name: "playlists.json",
      mimeType: "application/json",
      parents: [archiveFolderIdCache],
    };
    const media = {
      mimeType: "application/json",
      body: JSON.stringify(playlists, null, 2),
    };
    if (playlistsFileId) {
      await drive.files.update({
        fileId: playlistsFileId,
        media,
        fields: "id",
      });
    } else {
      const newFile = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: "id",
      });
      playlistsFileId = newFile.data.id;
    }
  } catch (error) {}
}

async function getOrCreateFolder(folderName, parentId = null) {
  try {
    if (
      folderName === "ArchiveYoutubePlaylist" &&
      archiveFolderIdCache &&
      !parentId
    )
      return archiveFolderIdCache;
    if (parentId) {
      const existingPlaylist = playlists.find(
        (p) => p.name === folderName && p.parentId === parentId,
      );
      if (existingPlaylist) return existingPlaylist.id;
    }
    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [archiveFolderIdCache],
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id",
    });
    const folderId = folder.data.id;
    if (parentId) {
      const newPlaylist = {
        id: folderId,
        name: folderName,
        parentId,
        songs: [],
      };
      playlists.push(newPlaylist);
      await savePlaylistsToDrive();
    }
    return folderId;
  } catch (error) {
    throw error;
  }
}

async function getFolders(parentId) {
  try {
    return playlists.filter((p) => p.parentId === parentId) || [];
  } catch (error) {
    return [];
  }
}

app.get("/health", (req, res) => res.send("OK"));

app.get("/protect", (req, res) => res.render("protect", { error: null }));

app.post("/protect", (req, res) => {
  const enteredCode = req.body.code;
  const protectionCode = process.env.PROTECTION_CODE || "1234";
  if (enteredCode === protectionCode) {
    req.session.authorized = true;
    res.redirect("/");
  } else {
    res.render("protect", { error: "Неверный код" });
  }
});

app.get("/", async (req, res) => {
  if (!req.session.authorized) return res.redirect("/protect");
  try {
    const archiveFolderId = await initializeArchiveFolder();
    const folders = (await getFolders(archiveFolderId)) || [];
    res.render("index", { folders });
  } catch (error) {
    res.status(500).render("error", { message: error.message });
  }
});

app.post("/download", async (req, res) => {
  if (!req.session.authorized) return res.redirect("/protect");
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    const metadata = await youtubedl(youtubeUrl, {
      dumpSingleJson: true,
      cookies: "cookies.txt",
    });
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: "cookies.txt",
    });
    await fsPromises.access(fileName);

    const archiveFolderId = await initializeArchiveFolder();
    if (!folderId && newFolderName)
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    else if (!folderId)
      folderId = await getOrCreateFolder("playlist", archiveFolderId);

    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream(fileName),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });

    const playlist = playlists.find((p) => p.id === folderId);
    if (playlist) {
      playlist.songs.push({ title, driveId: driveResponse.data.id });
      await savePlaylistsToDrive();
    }

    await fsPromises.unlink(fileName);
    const folders = await getFolders(archiveFolderId);
    res.render("success", { title, driveId: driveResponse.data.id, folders });
  } catch (error) {
    res.status(500).render("error", { message: error.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));

(async () => {
  await initializeArchiveFolder();
  await loadPlaylistsFromDrive();
  console.log("Инициализация завершена");
})();
