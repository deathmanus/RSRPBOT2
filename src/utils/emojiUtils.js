const { db } = require('../Database/database');

let emojis = null;

function loadEmojis() {
    if (emojis === null) {
        return new Promise((resolve, reject) => {
            db.get('SELECT value FROM config WHERE key = ?', ['emojis'], (err, row) => {
                if (err) {
                    console.error('Error loading emojis from database:', err);
                    // Použijeme výchozí prázdný objekt, když selže načítání
                    emojis = {};
                    resolve(emojis);
                    return;
                }
                
                if (!row) {
                    // Pokud emoji konfigurace neexistuje, vytvoříme ji s prázdným objektem
                    const defaultEmojis = {
                        money: "💰",
                        success: "✅",
                        error: "❌",
                        warning: "⚠️",
                        info: "ℹ️",
                        categories: {
                            "Air vehicles": "🚁",
                            "Ground vehicles": "🚗",
                            "Equipment": "🔧"
                        }
                    };
                    
                    db.run(
                        'INSERT INTO config (key, value) VALUES (?, ?)',
                        ['emojis', JSON.stringify(defaultEmojis)],
                        (insertErr) => {
                            if (insertErr) {
                                console.error('Error creating default emojis:', insertErr);
                                emojis = {};
                            } else {
                                console.log('Created default emojis configuration');
                                emojis = defaultEmojis;
                            }
                            resolve(emojis);
                        }
                    );
                } else {
                    try {
                        emojis = JSON.parse(row.value);
                        resolve(emojis);
                    } catch (parseErr) {
                        console.error('Error parsing emojis configuration:', parseErr);
                        emojis = {};
                        resolve(emojis);
                    }
                }
            });
        });
    }
    
    // Pokud jsou emoji už načteny, vrátíme je
    return Promise.resolve(emojis);
}

async function getEmoji(key) {
    const emojiConfig = await loadEmojis();
    return emojiConfig[key] || '';
}

async function getCategoryEmoji(category) {
    const emojiConfig = await loadEmojis();
    return emojiConfig.categories?.[category] || '';
}

// Synchronní verze pro zpětnou kompatibilitu
function getEmojiSync(key) {
    if (!emojis) {
        console.warn('Synchronous emoji access before initialization, returning empty string');
        return '';
    }
    return emojis[key] || '';
}

function getCategoryEmojiSync(category) {
    if (!emojis) {
        console.warn('Synchronous category emoji access before initialization, returning empty string');
        return '';
    }
    return emojis.categories?.[category] || '';
}

// Inicializace emoji při načtení modulu
loadEmojis().catch(err => {
    console.error('Failed to preload emojis:', err);
});

module.exports = {
    getEmoji,
    getCategoryEmoji,
    getEmojiSync,
    getCategoryEmojiSync
};