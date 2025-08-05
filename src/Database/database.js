const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./rsbot.db');

// Inicializace tabulek
db.serialize(() => {
    // Frakce
    db.run(`CREATE TABLE IF NOT EXISTS fractions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        money INTEGER DEFAULT 0,
        color TEXT,
        logoPath TEXT,
        warns INTEGER DEFAULT 0,
        roomId TEXT,
        leaderRoleId TEXT,
        deputyRoleId TEXT,
        fractionRoleId TEXT,
        creationDate TEXT
    )`);

    // Shop sekce
    db.run(`CREATE TABLE IF NOT EXISTS shop_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`);
    
    // Income role
    db.run(`CREATE TABLE IF NOT EXISTS income_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id TEXT UNIQUE,
        role_name TEXT,
        daily_income INTEGER,
        added_by TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Income historie
    db.run(`CREATE TABLE IF NOT EXISTS income_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        role_id TEXT,
        amount INTEGER,
        distribution_date TEXT,
        FOREIGN KEY(role_id) REFERENCES income_roles(role_id)
    )`);

    // Shop položky
    db.run(`CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER,
        name TEXT,
        type TEXT,
        base_price INTEGER,
        max_count INTEGER,
        min_count INTEGER,
        modifications TEXT,
        description TEXT,
        FOREIGN KEY(section_id) REFERENCES shop_sections(id)
    )`);

    // Nákupy (fraction inventory)
    db.run(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fraction_id INTEGER,
        item_id INTEGER,
        count INTEGER,
        selected_mods TEXT,
        total_price INTEGER,
        purchase_date TEXT,
        buyer TEXT,
        FOREIGN KEY(fraction_id) REFERENCES fractions(id),
        FOREIGN KEY(item_id) REFERENCES shop_items(id)
    )`);

    // Logy
    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ticket systém
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        status TEXT,
        config TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Oprávnění
    db.run(`CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        fraction_id INTEGER,
        role TEXT,
        granted_by TEXT,
        granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(fraction_id) REFERENCES fractions(id)
    )`);

    // Auditní logy akcí
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT,
        entity TEXT,
        entity_id TEXT,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Obchodní nabídky
    db.run(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT UNIQUE,
        seller TEXT,
        buyer TEXT,
        item_id INTEGER,
        count INTEGER DEFAULT 1,
        price INTEGER,
        status TEXT DEFAULT 'pending',
        created_by TEXT,
        created_at TEXT,
        accepted_by TEXT,
        accepted_at TEXT,
        declined_by TEXT,
        declined_at TEXT,
        FOREIGN KEY(item_id) REFERENCES purchases(id)
    )`);
});

// --- Frakce ---
function addFraction(
    name,
    description = "Without description",
    money = 0,
    color = "gray",
    logoPath = null,
    warns = 0,
    roomId = null,
    leaderRoleId = null,
    deputyRoleId = null,
    fractionRoleId = null,
    creationDate = null
) {
    db.run(
        `INSERT OR IGNORE INTO fractions 
        (name, description, money, color, logoPath, warns, roomId, leaderRoleId, deputyRoleId, fractionRoleId, creationDate) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, description, money, color, logoPath, warns, roomId, leaderRoleId, deputyRoleId, fractionRoleId, creationDate]
    );
}

function updateFraction(
    id,
    name,
    description,
    money,
    color,
    logoPath,
    warns,
    roomId,
    leaderRoleId,
    deputyRoleId,
    fractionRoleId,
    creationDate
) {
    db.run(
        `UPDATE fractions SET 
            name = ?, 
            description = ?, 
            money = ?, 
            color = ?, 
            logoPath = ?, 
            warns = ?, 
            roomId = ?, 
            leaderRoleId = ?, 
            deputyRoleId = ?, 
            fractionRoleId = ?, 
            creationDate = ?
        WHERE id = ?`,
        [name, description, money, color, logoPath, warns, roomId, leaderRoleId, deputyRoleId, fractionRoleId, creationDate, id]
    );
}

function updateFractionMoney(id, amount, isAdding = true) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE fractions SET money = money ${isAdding ? '+' : '-'} ? WHERE id = ?`,
            [amount, id],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            }
        );
    });
}

function getFractionById(id, callback) {
    db.get(`SELECT * FROM fractions WHERE id = ?`, [id], (err, row) => {
        callback(err, row);
    });
}

function getFractionByName(name, callback) {
    db.get(`SELECT * FROM fractions WHERE name = ?`, [name], (err, row) => {
        callback(err, row);
    });
}

function deleteFractionById(id) {
    db.run(`DELETE FROM fractions WHERE id = ?`, [id]);
}

// --- Shop sekce ---
function addShopSection(name) {
    db.run(`INSERT OR IGNORE INTO shop_sections (name) VALUES (?)`, [name]);
}

function deleteShopSection(name) {
    db.get(`SELECT id FROM shop_sections WHERE name = ?`, [name], (err, section) => {
        if (section) {
            db.run(`DELETE FROM shop_items WHERE section_id = ?`, [section.id]);
            db.run(`DELETE FROM shop_sections WHERE id = ?`, [section.id]);
        }
    });
}

// --- Shop položky ---
function addShopItem(sectionName, item) {
    db.get(`SELECT id FROM shop_sections WHERE name = ?`, [sectionName], (err, section) => {
        if (section) {
            db.run(`INSERT INTO shop_items (section_id, name, type, base_price, max_count, min_count, modifications, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    section.id,
                    item.name,
                    item.type,
                    item.basePrice,
                    item.maxCount || null,
                    item.minCount || null,
                    item.modifications ? JSON.stringify(item.modifications) : null,
                    item.description || null
                ]
            );
        }
    });
}

function getShopItems(sectionName, callback) {
    db.get(`SELECT id FROM shop_sections WHERE name = ?`, [sectionName], (err, section) => {
        if (section) {
            db.all(`SELECT * FROM shop_items WHERE section_id = ?`, [section.id], (err, rows) => {
                callback(err, rows);
            });
        } else {
            callback(null, []);
        }
    });
}

function deleteShopItem(itemName) {
    db.run(`DELETE FROM shop_items WHERE name = ?`, [itemName]);
}

// --- Fraction inventory (purchases) ---
function addFractionItem(fractionName, itemName, count, selectedMods, totalPrice, buyer) {
    getFractionByName(fractionName, (err, fraction) => {
        if (err || !fraction) return;
        db.get(`SELECT id FROM shop_items WHERE name = ?`, [itemName], (err, item) => {
            if (err || !item) return;
            db.run(`INSERT INTO purchases (fraction_id, item_id, count, selected_mods, total_price, purchase_date, buyer)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    fraction.id,
                    item.id,
                    count,
                    selectedMods ? JSON.stringify(selectedMods) : null,
                    totalPrice,
                    new Date().toISOString(),
                    buyer
                ]
            );
        });
    });
}

function getFractionItems(fractionName, callback) {
    getFractionByName(fractionName, (err, fraction) => {
        if (err || !fraction) return callback(err, []);
        db.all(`SELECT purchases.*, shop_items.name, shop_items.type, shop_items.modifications
                FROM purchases
                JOIN shop_items ON purchases.item_id = shop_items.id
                WHERE purchases.fraction_id = ?`, [fraction.id], (err, rows) => {
            callback(err, rows);
        });
    });
}

function deleteFractionItem(purchaseId) {
    db.run(`DELETE FROM purchases WHERE id = ?`, [purchaseId]);
}

// --- Logy, tickets, permissions, audit logs ---
function addLog(type, message) {
    db.run(
        `INSERT INTO logs (type, message) VALUES (?, ?)`,
        [type, message]
    );
}

function getLogs(type, limit = 100, callback) {
    const query = type 
        ? `SELECT * FROM logs WHERE type = ? ORDER BY created_at DESC LIMIT ?` 
        : `SELECT * FROM logs ORDER BY created_at DESC LIMIT ?`;
    const params = type ? [type, limit] : [limit];
    
    db.all(query, params, (err, rows) => {
        callback(err, rows);
    });
}

function addTicket(userId, status, config) {
    db.run(
        `INSERT INTO tickets (user_id, status, config) VALUES (?, ?, ?)`,
        [userId, status, config]
    );
}

function getTicketById(id, callback) {
    db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
        callback(err, row);
    });
}

function updateTicketStatus(id, status) {
    db.run(`UPDATE tickets SET status = ? WHERE id = ?`, [status, id]);
}

function addPermission(userId, fractionId, role, grantedBy) {
    db.run(
        `INSERT INTO permissions (user_id, fraction_id, role, granted_by) VALUES (?, ?, ?, ?)`,
        [userId, fractionId, role, grantedBy]
    );
}

function getPermissions(userId, callback) {
    db.all(`SELECT * FROM permissions WHERE user_id = ?`, [userId], (err, rows) => {
        callback(err, rows);
    });
}

function addAuditLog(userId, action, entity, entityId, details) {
    db.run(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
        [userId, action, entity, entityId, details]
    );
}

// --- Income systém ---
function addIncomeRole(roleId, roleName, dailyIncome, addedBy) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO income_roles (role_id, role_name, daily_income, added_by) VALUES (?, ?, ?, ?)`,
            [roleId, roleName, dailyIncome, addedBy],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function getIncomeRoles(callback) {
    db.all(`SELECT * FROM income_roles ORDER BY daily_income DESC`, [], (err, rows) => {
        callback(err, rows);
    });
}

function removeIncomeRole(roleId, callback) {
    db.run(`DELETE FROM income_roles WHERE role_id = ?`, [roleId], function(err) {
        callback(err, this.changes > 0);
    });
}

function addIncomeDistribution(userId, roleId, amount, date) {
    db.run(
        `INSERT INTO income_history (user_id, role_id, amount, distribution_date) VALUES (?, ?, ?, ?)`,
        [userId, roleId, amount, date]
    );
}

function getIncomeHistory(userId, limit, callback) {
    db.all(
        `SELECT ih.*, ir.role_name 
         FROM income_history ih
         LEFT JOIN income_roles ir ON ih.role_id = ir.role_id
         WHERE ih.user_id = ?
         ORDER BY ih.distribution_date DESC
         LIMIT ?`,
        [userId, limit || 10],
        (err, rows) => {
            callback(err, rows);
        }
    );
}

// --- Obchodní nabídky ---
function createTrade(tradeData) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO trades (
                trade_id, seller, buyer, item_id, count, 
                price, status, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tradeData.id,
                tradeData.seller,
                tradeData.buyer,
                tradeData.item.id,
                tradeData.count,
                tradeData.price,
                'pending',
                tradeData.createdBy,
                tradeData.createdAt
            ],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function getTradeById(tradeId, callback) {
    db.get(
        `SELECT t.*, p.*, s.* 
         FROM trades t
         JOIN purchases p ON t.item_id = p.id
         JOIN shop_items s ON p.item_id = s.id
         WHERE t.trade_id = ?`,
        [tradeId],
        (err, row) => {
            callback(err, row);
        }
    );
}

function updateTradeStatus(tradeId, status, userData) {
    return new Promise((resolve, reject) => {
        let query = '';
        let params = [];
        
        if (status === 'accepted') {
            query = `UPDATE trades SET 
                    status = ?, 
                    accepted_by = ?, 
                    accepted_at = ?
                    WHERE trade_id = ?`;
            params = [status, userData.user, userData.timestamp, tradeId];
        } else if (status === 'declined') {
            query = `UPDATE trades SET 
                    status = ?, 
                    declined_by = ?, 
                    declined_at = ?
                    WHERE trade_id = ?`;
            params = [status, userData.user, userData.timestamp, tradeId];
        }
        
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
        });
    });
}

// Export všech funkcí
module.exports = {
    db,
    // Frakce
    addFraction,
    updateFraction,
    updateFractionMoney,
    getFractionById,
    getFractionByName,
    deleteFractionById,
    // Shop sekce
    addShopSection,
    deleteShopSection,
    // Shop položky
    addShopItem,
    getShopItems,
    deleteShopItem,
    // Fraction inventory
    addFractionItem,
    getFractionItems,
    deleteFractionItem,
    // Logy, tickets, permissions, audit logs
    addLog,
    getLogs,
    addTicket,
    getTicketById,
    updateTicketStatus,
    addPermission,
    getPermissions,
    addAuditLog,
    // Income systém
    addIncomeRole,
    getIncomeRoles,
    removeIncomeRole,
    addIncomeDistribution,
    getIncomeHistory,
    // Obchody
    createTrade,
    getTradeById,
    updateTradeStatus
};