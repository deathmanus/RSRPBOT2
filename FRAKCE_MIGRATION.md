no# Migrace frakčních commandů - /frakce

## Co bylo změněno

Sloučili jsme tři samostatné commandy do jednoho sjednoceného commandu `/frakce`:

### Původní commandy (nyní v backup_old_fraction_commands/):
- `manageFractionRoles.js` - správa rolí členů frakce
- `EditFraction.js` - úprava nastavení frakce  
- `FractionInfo.js` - zobrazení informací o frakci

### Nový command `/frakce` obsahuje:

#### `/frakce info`
- Zobrazí informace o vybrané frakci
- Obsahuje všechny funkce původního `FractionInfo.js`
- Interaktivní dropdown menu pro výběr frakce
- Zobrazuje vedení, členy, inventář, statistiky

#### `/frakce edit`
- Upravuje nastavení frakce (popis, barva, obrázek)
- Obsahuje všechny funkce původního `EditFraction.js`
- Pouze členové frakce mohou upravovat svoji frakci

#### `/frakce role add <user> [deputy]`
- Přidává uživatele do frakce
- Možnost přidat jako zástupce
- Interaktivní pozvánka s tlačítky přijmout/odmítnout

#### `/frakce role remove <user>`
- Odebírá uživatele z frakce
- Automaticky odebírá i deputy roli

## Výhody nového přístupu

1. **Lepší organizace** - vše týkající se frakcí na jednom místě
2. **Konzistence** - jednotný styl commandů
3. **Menší počet commandů** - uživatelé si nemusí pamatovat tolik commandů
4. **Snadnější maintenance** - jedna codebase místo tří

## Kompatibilita

- Všechny existující handlery (RoleHandler.js) zůstávají beze změny
- Database operace zůstávají stejné
- Žádné breaking changes pro uživatele (kromě změny názvů commandů)

## Použití

```
/frakce info                    - Zobrazí informace o frakci
/frakce edit [popis] [barva] [obrazek] - Upraví frakci
/frakce role add <user> [deputy] - Přidá člena
/frakce role remove <user>       - Odebere člena
```
