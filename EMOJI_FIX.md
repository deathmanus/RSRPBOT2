# Oprava emoji zobrazování v /frakce info

## Problém
V `/frakce info` commandu se místo emoji zobrazovaly `[object Promise]` texty:

```
[object Promise] Vedení
[object Promise] Velitel: death_man
[object Promise] Zástupce: annny69
```

## Příčina
Funkce `getEmoji()` z `emojiUtils.js` je **asynchronní** (vrací Promise), ale v kódu byla používána **synchronně** bez `await`.

### Problematický kód:
```javascript
// ŠPATNĚ - getEmoji() vrací Promise, ale není awaited
name: `${getEmoji('members')} Vedení`,
value: `${getEmoji('leader')} **Velitel:** ${leader}`
```

## Řešení

### Nový přístup:
1. **Pre-loadování emoji** - na začátku funkce načtu všechna potřebná emoji
2. **Fallback hodnoty** - pokud emoji nejsou dostupná, použiju výchozí
3. **Async/await pattern** - správné asynchronní načítání

### Opravený kód:
```javascript
// SPRÁVNĚ - Pre-load všech emoji s fallback hodnotami
const emojis = {
    fraction: await getEmoji('fraction') || '🏛️',
    members: await getEmoji('members') || '👥',
    leader: await getEmoji('leader') || '👑',
    deputy: await getEmoji('deputy') || '🥈',
    member: await getEmoji('member') || '👤',
    roles: await getEmoji('roles') || '🎭',
    stats: await getEmoji('stats') || '📊',
    money: await getEmoji('money') || '💰',
    warns: await getEmoji('warns') || '⚠️',
    dates: await getEmoji('dates') || '📅',
    channel: await getEmoji('channel') || '💬',
    inventory: await getEmoji('inventory') || '📦'
};

// Pak použití:
name: `${emojis.members} Vedení`,
value: `${emojis.leader} **Velitel:** ${leader}`
```

## Opravené části

1. **Embed title** - `${emojis.fraction} ${fractionData.name}`
2. **Field names** - Vedení, Role, Statistiky, Inventář
3. **Field values** - všechny emoji v content
4. **Error messages** - emoji v chybových zprávách
5. **Initial embed** - info emoji v úvodní zprávě

## Výsledek

Po opravě by se měly zobrazovat správné emoji místo `[object Promise]` textů:

```
🏛️ test
👥 Vedení
👑 Velitel: death_man
🥈 Zástupce: annny69
👤 Počet členů: 3
```

## Další benefity

- **Fallback emoji** - pokud databáze neobsahuje emoji konfiguraci
- **Performance** - emoji se načtou jednou místo opakovaně
- **Čitelnější kód** - jasné oddělení emoji načítání od jejich použití
