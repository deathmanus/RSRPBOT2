const fs = require('fs');
const path = require('path');

let emojis = null;

function loadEmojis() {
    if (emojis === null) {
        const configPath = path.join(__dirname, '../files/config/emojis.json');
        try {
            emojis = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            console.error('Error loading emojis:', error);
            emojis = {};
        }
    }
    return emojis;
}

function getEmoji(key) {
    const emojiConfig = loadEmojis();
    return emojiConfig[key] || '';
}

function getCategoryEmoji(category) {
    const emojiConfig = loadEmojis();
    return emojiConfig.categories?.[category] || '';
}

module.exports = {
    getEmoji,
    getCategoryEmoji
};