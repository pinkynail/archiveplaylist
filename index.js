const express = require('express');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs'); // Добавляем модуль для работы с файлами
const app = express();

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send(`
        <h1>Archive Playlist</h1>
        <form method="POST" action="/download">
            <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required>
            <button type="submit">Сохранить</button>
        </form>
    `);
});

app.post('/download', async (req, res) => {
    const youtubeUrl = req.body.youtube_url;
    try {
        await youtubedl(youtubeUrl, {
            extractAudio: true,
            audioFormat: 'mp3',
            output: 'song.mp3',
            cookies: 'cookies.txt'
        });
        console.log('Скачано:', youtubeUrl);
        // Проверяем, существует ли файл
        if (fs.existsSync('song.mp3')) {
            res.send(`Аудио скачано из: ${youtubeUrl} и сохранено как song.mp3`);
        } else {
            res.send(`Аудио скачано из: ${youtubeUrl}, но файл не найден`);
        }
    } catch (error) {
        console.error('Ошибка:', error);
        res.send(`Ошибка при скачивании: ${error.message}`);
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});