const { EmbedBuilder } = require('discord.js');
const { getEmojiSync } = require('../../utils/emojiUtils');
const { 
    db, 
    getTradeById, 
    updateTradeStatus, 
    updateFractionMoney, 
    getFractionByName, 
    deleteFractionItem, 
    addFractionItem, 
    getFractionItems,
    addAuditLog
} = require('../../Database/database');

async function handleTradeResponse(interaction) {
    const [action, tradeId] = interaction.customId.split(':');
    
    if (!['accept-trade', 'decline-trade'].includes(action)) return;

    try {
        await interaction.deferUpdate();

        // Get trade data from database
        let tradeData = null;
        await new Promise((resolve) => {
            getTradeById(tradeId, (err, trade) => {
                if (!err && trade) {
                    tradeData = trade;
                }
                resolve();
            });
        });
        
        if (!tradeData) {
        // Get trade data from database
        let tradeData = null;
        await new Promise((resolve) => {
            getTradeById(tradeId, (err, trade) => {
                if (!err && trade) {
                    tradeData = trade;
                }
                resolve();
            });
        });
        
        if (!tradeData) {
            return await interaction.editReply({
                content: `${getEmojiSync('error')} Tato obchodní nabídka již není platná.`,
                components: []
            });
        }
        
        if (!await checkFractionMembership(interaction, tradeData)) return;

        if (action === 'accept-trade') {
            await processTrade(interaction, tradeData, tradeId);
            await processTrade(interaction, tradeData, tradeId);
        } else {
            await declineTrade(interaction, tradeData, tradeId);
            await declineTrade(interaction, tradeData, tradeId);
        }
    } catch (error) {
        console.error('Error handling trade response:', error);
        await interaction.followUp({
            content: `${getEmojiSync('error')} Nastala chyba při zpracování odpovědi na obchodní nabídku.`,
            ephemeral: true
        });
    }
}

async function checkFractionMembership(interaction, tradeData) {
    const member = interaction.member;
    const hasFractionRole = member.roles.cache.some(role => role.name === tradeData.buyer);

    if (!hasFractionRole) {
        await interaction.followUp({
            content: `${getEmojiSync('error')} Nejste členem této frakce.`,
            ephemeral: true
        });
        return false;
    }
    
    // Zkontrolovat, zda má oprávnění (velitel nebo zástupce)
    if (!member.roles.cache.some(role => 
        role.name.startsWith('Velitel') || role.name.startsWith('Zástupce')
    )) {
        await interaction.followUp({
            content: `${getEmojiSync('error')} Nemáte oprávnění přijímat obchodní nabídky. Pouze velitelé a zástupci frakcí mohou používat tuto funkci.`,
            ephemeral: true
        });
        return false;
    }
    
    return true;
}

async function processTrade(interaction, tradeData, tradeId) {
    // Get fractions data
    let buyerFractionData = null;
    let sellerFractionData = null;
    
    await new Promise((resolve) => {
        getFractionByName(tradeData.buyer, (err, fraction) => {
            buyerFractionData = fraction;
            resolve();
        });
    });
    
    await new Promise((resolve) => {
        getFractionByName(tradeData.seller, (err, fraction) => {
            sellerFractionData = fraction;
            resolve();
        });
    });
    
    if (!buyerFractionData || !sellerFractionData) {
        return await interaction.followUp({
            content: `${getEmojiSync('error')} Nastala chyba při načítání dat frakcí.`,
            ephemeral: true
        });
    }

    // Check if buyer has enough money
    if (buyerFractionData.money < tradeData.price) {
        return await interaction.followUp({
            content: `${getEmojiSync('error')} Vaše frakce nemá dostatek peněz (${tradeData.price} ${getEmojiSync('money')}).`,
            ephemeral: true
        });
    }

    try {
        // Transfer items
        await transferTradeItems(tradeData);
        
        // Update money for both fractions
        await updateFractionMoney(buyerFractionData.id, tradeData.price, false); // odebrat peníze kupujícímu
        await updateFractionMoney(sellerFractionData.id, tradeData.price, true); // přidat peníze prodávajícímu
        
        // Update fractions data for display
        buyerFractionData.money -= tradeData.price;
        sellerFractionData.money += tradeData.price;
        
        // Update trade status in database
        await updateTradeStatus(tradeId, 'accepted', {
            user: interaction.user.tag,
            timestamp: new Date().toISOString()
        });
        
        // Add audit log
        addAuditLog(
            interaction.user.id,
            'accept_trade',
            'trade',
            tradeId,
            JSON.stringify({
                seller: tradeData.seller,
                buyer: tradeData.buyer,
                itemId: tradeData.id,
                itemName: tradeData.name,
                count: tradeData.count,
                price: tradeData.price
            })
        );
    try {
        // Transfer items
        await transferTradeItems(tradeData);
        
        // Update money for both fractions
        await updateFractionMoney(buyerFractionData.id, tradeData.price, false); // odebrat peníze kupujícímu
        await updateFractionMoney(sellerFractionData.id, tradeData.price, true); // přidat peníze prodávajícímu
        
        // Update fractions data for display
        buyerFractionData.money -= tradeData.price;
        sellerFractionData.money += tradeData.price;
        
        // Update trade status in database
        await updateTradeStatus(tradeId, 'accepted', {
            user: interaction.user.tag,
            timestamp: new Date().toISOString()
        });
        
        // Add audit log
        addAuditLog(
            interaction.user.id,
            'accept_trade',
            'trade',
            tradeId,
            JSON.stringify({
                seller: tradeData.seller,
                buyer: tradeData.buyer,
                itemId: tradeData.id,
                itemName: tradeData.name,
                count: tradeData.count,
                price: tradeData.price
            })
        );

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00FF00)
            .setTitle(`${getEmojiSync('success')} Obchodní nabídka přijata`)
            .addFields(
                { name: 'Přijal', value: interaction.user.tag, inline: true },
                { name: 'Stav peněz', value: `Prodávající: ${sellerFractionData.money} ${getEmojiSync('money')}\nKupující: ${buyerFractionData.money} ${getEmojiSync('money')}` }
            );

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });
        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `${getEmojiSync('success')} Obchodní nabídka byla úspěšně přijata a zpracována.`,
            ephemeral: true
        });
    } catch (error) {
        console.error('Error processing trade:', error);
        await interaction.followUp({
            content: `${getEmojiSync('error')} Nastala chyba při zpracování obchodní nabídky.`,
            ephemeral: true
        });
    }
}

async function declineTrade(interaction, tradeData, tradeId) {
    try {
        // Update trade status in database
        await updateTradeStatus(tradeId, 'declined', {
            user: interaction.user.tag,
            timestamp: new Date().toISOString()
        });
        
        // Add audit log
        addAuditLog(
            interaction.user.id,
            'decline_trade',
            'trade',
            tradeId,
            JSON.stringify({
                seller: tradeData.seller,
                buyer: tradeData.buyer,
                itemId: tradeData.id,
                itemName: tradeData.name
            })
        );

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setTitle(`${getEmojiSync('error')} Obchodní nabídka odmítnuta`)
            .addFields(
                { name: 'Odmítl', value: interaction.user.tag, inline: true }
            );

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });
        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `${getEmojiSync('error')} Obchodní nabídka byla odmítnuta.`,
            ephemeral: true
        });
    } catch (error) {
        console.error('Error declining trade:', error);
        await interaction.followUp({
            content: `${getEmojiSync('error')} Nastala chyba při odmítání obchodní nabídky.`,
            ephemeral: true
        });
    }
}

async function transferTradeItems(tradeData) {
    const { buyer, seller, id: itemId, count } = tradeData;
    
    // Get item data from database
    let itemData = null;
    await new Promise((resolve) => {
        db.get(
            `SELECT purchases.*, shop_items.* 
             FROM purchases 
             JOIN shop_items ON purchases.item_id = shop_items.id 
             WHERE purchases.id = ?`,
            [itemId],
            (err, row) => {
                if (!err && row) {
                    itemData = row;
                }
                resolve();
            }
        );
    });
    
    if (!itemData) {
        throw new Error('Item not found in database');
    }
    
    // Get buyer and seller fraction IDs
    let buyerFractionId = null;
    let sellerFractionId = null;
    
    await new Promise((resolve) => {
        getFractionByName(buyer, (err, fraction) => {
            if (!err && fraction) {
                buyerFractionId = fraction.id;
            }
            resolve();
        });
    });
    
    await new Promise((resolve) => {
        getFractionByName(seller, (err, fraction) => {
            if (!err && fraction) {
                sellerFractionId = fraction.id;
            }
            resolve();
        });
    });
    
    if (!buyerFractionId || !sellerFractionId) {
        throw new Error('Fraction not found in database');
    }
    
    if (itemData.type === 'countable') {
        if (itemData.count === count) {
            // Delete the item completely from seller
            await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM purchases WHERE id = ?`,
                    [itemId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
    const { buyer, seller, id: itemId, count } = tradeData;
    
    // Get item data from database
    let itemData = null;
    await new Promise((resolve) => {
        db.get(
            `SELECT purchases.*, shop_items.* 
             FROM purchases 
             JOIN shop_items ON purchases.item_id = shop_items.id 
             WHERE purchases.id = ?`,
            [itemId],
            (err, row) => {
                if (!err && row) {
                    itemData = row;
                }
                resolve();
            }
        );
    });
    
    if (!itemData) {
        throw new Error('Item not found in database');
    }
    
    // Get buyer and seller fraction IDs
    let buyerFractionId = null;
    let sellerFractionId = null;
    
    await new Promise((resolve) => {
        getFractionByName(buyer, (err, fraction) => {
            if (!err && fraction) {
                buyerFractionId = fraction.id;
            }
            resolve();
        });
    });
    
    await new Promise((resolve) => {
        getFractionByName(seller, (err, fraction) => {
            if (!err && fraction) {
                sellerFractionId = fraction.id;
            }
            resolve();
        });
    });
    
    if (!buyerFractionId || !sellerFractionId) {
        throw new Error('Fraction not found in database');
    }
    
    if (itemData.type === 'countable') {
        if (itemData.count === count) {
            // Delete the item completely from seller
            await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM purchases WHERE id = ?`,
                    [itemId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        } else {
            // Update the count for seller
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE purchases SET count = count - ? WHERE id = ?`,
                    [count, itemId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        
        // Check if buyer already has this item
            // Update the count for seller
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE purchases SET count = count - ? WHERE id = ?`,
                    [count, itemId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        
        // Check if buyer already has this item
        let existingItem = null;
        await new Promise((resolve) => {
            db.get(
                `SELECT * FROM purchases 
                 WHERE fraction_id = ? 
                 AND item_id = ?`,
                [buyerFractionId, itemData.item_id],
                (err, row) => {
                    if (!err && row) {
                        existingItem = row;
                    }
                    resolve();
                }
            );
        });
        
        await new Promise((resolve) => {
            db.get(
                `SELECT * FROM purchases 
                 WHERE fraction_id = ? 
                 AND item_id = ?`,
                [buyerFractionId, itemData.item_id],
                (err, row) => {
                    if (!err && row) {
                        existingItem = row;
                    }
                    resolve();
                }
            );
        });
        
        if (existingItem) {
            // Update count for existing item
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE purchases SET count = count + ? WHERE id = ?`,
                    [count, existingItem.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            // Update count for existing item
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE purchases SET count = count + ? WHERE id = ?`,
                    [count, existingItem.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        } else {
            // Create new item for buyer
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO purchases 
                     (fraction_id, item_id, count, selected_mods, total_price, purchase_date, buyer)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        buyerFractionId,
                        itemData.item_id,
                        count,
                        itemData.selected_mods,
                        0, // Cena je 0, protože je to přes obchod
                        new Date().toISOString(),
                        'trade' // Označení, že bylo získáno obchodem
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            // Create new item for buyer
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO purchases 
                     (fraction_id, item_id, count, selected_mods, total_price, purchase_date, buyer)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        buyerFractionId,
                        itemData.item_id,
                        count,
                        itemData.selected_mods,
                        0, // Cena je 0, protože je to přes obchod
                        new Date().toISOString(),
                        'trade' // Označení, že bylo získáno obchodem
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
    } else {
        // Pro necountable předměty - přesunout celý předmět
        // Aktualizovat vlastníka předmětu
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE purchases SET fraction_id = ?, buyer = ? WHERE id = ?`,
                [buyerFractionId, 'trade', itemId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        // Pro necountable předměty - přesunout celý předmět
        // Aktualizovat vlastníka předmětu
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE purchases SET fraction_id = ?, buyer = ? WHERE id = ?`,
                [buyerFractionId, 'trade', itemId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

module.exports = { handleTradeResponse };
