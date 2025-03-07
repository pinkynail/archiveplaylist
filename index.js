const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const session = require("express-session");
const Redis = require("redis");
const RedisStore = require("connect-redis")(session);
const app = express();

// Настройка Redis
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
redisClient.on("error", (err) => console.log("Redis Client Error:", err));
(async () => {
  try {
    await redisClient.connect();
    console.log("Redis connected successfully");
  } catch (err) {
    console.error("Failed to connect to Redis:", err);
  }
})();

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Google Drive setup с тайм-аутом
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
const drive = google.drive({
  version: "v3",
  auth: oAuth2Client,
  timeout: 5000, // Уменьшен до 5 секунд
});

let archiveFolderIdCache = null;
let playlists = [];

async function initializeArchiveFolder() {
  if (archiveFolderIdCache) return archiveFolderIdCache;
  archiveFolderIdCache = "1opfVlshZHmomjtmdoFnffH7N-sTBAbEB";
  try {
    await drive.files.get({ fileId: archiveFolderIdCache });
  } catch (error) {
    console.error("Error verifying folder:", error.message);
    throw new Error("Указанный ID папки недоступен");
  }
  return archiveFolderIdCache;
}

async function loadPlaylistsFromDrive() {
  const playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs";
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
    const file = await drive.files.get({
      fileId: playlistsFileId,
      alt: "media",
    });
    playlists = file.data || [];
    console.log("Playlists loaded:", playlists);
  } catch (error) {
    console.error("Error loading playlists:", error.message);
    playlists = [];
  }
}

async function savePlaylistsToDrive() {
  const playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs";
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
    }
  } catch (error) {
    console.error("Error saving playlists:", error.message);
  }
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
    console.error("Error in getFolders:", error.message);
    return [];
  }
}

async function clearAllPlaylists() {
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
    playlists = [];
    await savePlaylistsToDrive();
    const files = await drive.files.list({
      q: `'${archiveFolderIdCache}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(id)",
    });
    for (const file of files.data.files) {
      await drive.files.delete({ fileId: file.id });
    }
  } catch (error) {
    throw error;
  }
}

// Middleware для логирования всех запросов
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - Started`);
  const originalEnd = res.end;
  res.end = function (...args) {
    console.log(
      `${req.method} ${req.url} - Finished with status ${res.statusCode}`,
    );
    originalEnd.apply(res, args);
  };
  next();
});

app.get("/health", (req, res) => res.send("OK"));

app.get("/protect", async (req, res) => {
  console.log("GET /protect: Rendering protect page");
  res.render("protect", { error: null });
});

app.post("/protect", async (req, res) => {
  console.log("POST /protect: Received request with body:", req.body);
  const enteredCode = req.body.code;
  const protectionCode = process.env.PROTECTION_CODE || "1234";
  if (enteredCode === protectionCode) {
    console.log("Code correct, setting session.authorized to true");
    req.session.authorized = true;
    try {
      await req.session.save();
      console.log("Session saved, session data:", req.session);
      console.log("Redirecting to /");
      res.redirect("/");
    } catch (err) {
      console.error("Error saving session:", err);
      res.status(500).render("error", { message: "Ошибка сохранения сессии" });
    }
  } else {
    console.log("Code incorrect");
    res.render("protect", { error: "Неверный код" });
  }
});

app.get("/", async (req, res) => {
  console.log("GET /: Checking session...");
  console.log("Session data:", req.session);
  if (!req.session.authorized) {
    console.log("Not authorized, redirecting to /protect");
    return res.redirect("/protect");
  }
  try {
    console.log("Calling initializeArchiveFolder...");
    const archiveFolderId = await initializeArchiveFolder();
    console.log("Calling getFolders with archiveFolderId:", archiveFolderId);
    const folders = (await getFolders(archiveFolderId)) || [];
    console.log("Rendering index with folders:", folders.length, "folders");
    res.render("index", { folders });
  } catch (error) {
    console.error("Error in GET /:", error.message);
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

app.post("/clear", async (req, res) => {
  if (!req.session.authorized) return res.redirect("/protect");
  try {
    await clearAllPlaylists();
    res.redirect("/");
  } catch (error) {
    res.status(500).render("error", { message: error.message });
  }
});

const PORT = process.env.PORT || 10000; // Явно указываем порт Render
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Server ready to accept requests");
});

// Ленивая загрузка плейлистов
setTimeout(async () => {
  await loadPlaylistsFromDrive();
  console.log("Playlists loaded lazily");
}, 1000);
