# Oprava chyby v kontrole frakcí - /frakce command

## Problém
Při pokusu o přidání uživatele do frakce pomocí `/frakce role add` se zobrazovala chybová zpráva "❌ Již jste členem jiné frakce.", i když uživatel neměl žádnou frakční roli.

## Příčina
Kód obsahoval **synchronní logickou chybu** v kontrole frakcí:

### Původní problematický kód:
```javascript
// ŠPATNĚ - some() neočekává Promise objekty
const hasAnyFraction = targetMember.roles.cache.some(r => {
    return new Promise((resolve) => {
        getFractionByName(r.name, (err, fraction) => {
            resolve(fraction !== undefined);
        });
    });
});
```

### Proč to nefungovalo:
1. `Array.some()` je synchronní metoda
2. Vrácené Promise objekty byly okamžitě vyhodnoceny jako `truthy` 
3. `some()` vždy vracel `true` (protože Promise objekt je truthy)
4. Výsledkem bylo, že `hasAnyFraction` bylo vždy `true`

## Řešení

### Opravený kód:
```javascript
// SPRÁVNĚ - asynchronní kontrola s await
let hasAnyFraction = false;
for (const role of targetMember.roles.cache.values()) {
    const fractionExists = await new Promise((resolve) => {
        getFractionByName(role.name, (err, fraction) => {
            resolve(fraction !== undefined && !err);
        });
    });
    if (fractionExists) {
        hasAnyFraction = true;
        break;
    }
}
```

## Opravené funkce

1. **handleRoleAdd()** - kontrola, zda je uživatel již v jiné frakci
2. **handleEdit()** - kontrola, zda je uživatel členem nějaké frakce

## Testování

Po opravě by měl command `/frakce role add` správně:
- ✅ Přidat uživatele, který není v žádné frakci
- ❌ Odmítnout uživatele, který už je v jiné frakci
- ✅ Správně detekovat frakční role pomocí databáze

## Dodatečné bezpečnostní opatření

Oprava také přidala kontrolu `!err` pro lepší error handling při databázových dotazech.
