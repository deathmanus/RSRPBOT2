# Capturing Systém - Nové funkce

Tato dokumentace popisuje nově implementované funkce pro counting/capturing systém v RSRPBOTu.

## Nové příkazy

### 1. `/capture`
**Popis:** Zabere basepoint pro vaši frakci  
**Oprávnění:** Všichni členové frakcí  
**Parametry:**
- `basepoint` (povinné) - Výběr z povolených basepointů (autocomplete)
- `image` (povinné) - Fotka potvrzující zabrání basepoint

**Použití:**
```
/capture basepoint:"Armádní základna" image:[příloha]
```

**Funkce:**
- Kontroluje, zda je SSU aktivní
- Ověřuje, že uživatel je členem frakce
- Kontroluje, zda je basepoint povolen v databázi
- Ukládá zabrání do databáze s časem a obrázkem
- Zobrazuje potvrzovací zprávu s embed
- **Nově:** Autocomplete pro výběr z povolených basepointů

### 2. `/de-capture`
**Popis:** Odebere zabrání basepoint (pouze pro administrátory)  
**Oprávnění:** Administrátoři nebo moderátoři  
**Parametry:**
- `capture_id` (povinné) - ID zabrání k odebrání

**Použití:**
```
/de-capture capture_id:123
```

**Funkce:**
- Označí zabrání jako neaktivní
- Zobrazí informace o odebraném zabrání

### 3. `/zabírání_start`
**Popis:** Spuštění SSU (Special Server Unit)  
**Oprávnění:** Administrátoři nebo moderátoři  

**Funkce:**
- Aktivuje SSU systém
- Spustí automatické udělování odměn
- Umožní hráčům používat `/capture`

### 4. `/zabírání_konec`
**Popis:** Ukončení SSU  
**Oprávnění:** Administrátoři nebo moderátoři  

**Funkce:**
- Deaktivuje SSU systém
- Zastaví automatické udělování odměn
- Zobrazí konečné statistiky
- **Poznámka:** Zabrané basepointy zůstávají v systému!

### 5. `/capture_status`
**Popis:** Zobrazí aktuální stav zabírání  
**Oprávnění:** Všichni  

**Funkce:**
- Zobrazí, zda je SSU aktivní
- Ukáže aktuální skóre frakcí
- Zobrazí posledních 5 zabrání
- Informace o automatických odměnách

### 6. `/captures_list`
**Popis:** Zobrazí seznam všech zabraných basepointů  
**Oprávnění:** Všichni  
**Parametry:**
- `fraction` (volitelné) - Filtr podle frakce

**Funkce:**
- Zobrazí všechna aktivní zabrání
- Možnost filtrování podle frakce
- Obsahuje ID pro možnost odebrání

### 7. `/count` (upraveno)
**Popis:** Spočítá basepointy (nová verze)  
**Oprávnění:** Všichni  

**Funkce:**
- Nyní využívá databázi namísto čtení zpráv
- Zobrazuje vítězné frakce pro každý basepoint
- Kompatibilní s novým capturing systémem

### 8. `/manage_basepoints`
**Popis:** Správa povolených basepointů  
**Oprávnění:** Administrátoři nebo moderátoři  

**Subcommandy:**
- `add` - Přidá nový basepoint
- `remove` - Odebere basepoint (deaktivuje)
- `list` - Zobrazí všechny basepointy
- `edit` - Upraví existující basepoint

**Použití:**
```
/manage_basepoints add name:"Nová základna" description:"Popis"
/manage_basepoints remove id:123
/manage_basepoints list show_inactive:true
/manage_basepoints edit id:123 name:"Nový název"
```

### 9. `/bulk_add_basepoints`
**Popis:** Hromadně přidá basepointy ze seznamu  
**Oprávnění:** Administrátoři nebo moderátoři  
**Parametry:**
- `basepoints` (povinné) - Seznam oddělený čárkami

**Použití:**
```
/bulk_add_basepoints basepoints:"Základna A, Základna B, Továrna, Letiště"
```

**Funkce:**
- Přidá až 20 basepointů najednou
- Zobrazí výsledky (úspěch, duplicity, chyby)
- Užitečné pro rychlé nastavení nových serverů

## Automatický systém odměn

### Funkcionalita
- **Frekvence:** Každých 30 minut
- **Odměna:** 2 body za každý zabraný basepoint
- **Aktivace:** Pouze když je SSU aktivní
- **Příjemci:** Frakční rozpočty

### Průběh odměňování
1. Systém kontroluje, zda je SSU aktivní
2. Získá počet zabraných basepointů pro každou frakci
3. Vypočítá odměny (počet_basepointů × 2)
4. Přičte body do frakčních rozpočtů
5. Pošle notifikaci do kanálu

### Oznámení
Automatické zprávy se posílají do kanálů obsahujících v názvu:
- "log"
- "counting"
- "bot"
- "capture"

## Databázové změny

### Nové tabulky

#### `captured_points`
```sql
- id (PRIMARY KEY)
- fraction_name (TEXT)
- basepoint_name (TEXT)
- captured_by (TEXT)
- captured_at (TEXT)
- image_url (TEXT)
- status (TEXT DEFAULT 'active')
- created_at (TEXT DEFAULT CURRENT_TIMESTAMP)
```

#### `basepoints`
```sql
- id (PRIMARY KEY)
- name (TEXT UNIQUE NOT NULL)
- description (TEXT)
- added_by (TEXT)
- added_at (TEXT DEFAULT CURRENT_TIMESTAMP)
- is_active (INTEGER DEFAULT 1)
```

#### `ssu_status`
```sql
- id (PRIMARY KEY)
- is_active (INTEGER DEFAULT 0)
- started_at (TEXT)
- ended_at (TEXT)
- started_by (TEXT)
- ended_by (TEXT)
- created_at (TEXT DEFAULT CURRENT_TIMESTAMP)
```

## Inicializace basepointů

Při prvním spuštění bota se automaticky vytvoří základní basepointy:
- Armádní základna
- Policejní stanice  
- Nemocnice
- Letiště
- Přístav
- Továrna
- Radnice
- Banka

Administrátoři mohou tyto basepointy upravit nebo přidat nové pomocí příkazů pro správu.

## Workflow použití

### Nastavení basepointů
1. Admin použije `/manage_basepoints list` pro zobrazení aktuálních basepointů
2. `/manage_basepoints add` pro přidání nových basepointů
3. `/bulk_add_basepoints` pro hromadné přidání více basepointů
4. `/manage_basepoints remove` nebo `edit` pro úpravy

### Spuštění SSU
1. Admin použije `/zabírání_start`
2. Systém oznámí start a aktivuje capturing
3. Automatické odměny se začnou udělovat každých 30 minut

### Během SSU
1. Hráči používají `/capture` k zabírání basepointů
2. Každých 30 minut se automaticky udělují odměny
3. `/capture_status` nebo `/captures_list` pro kontrolu stavu
4. Admin může použít `/de-capture` k odebrání neplatných zabrání

### Ukončení SSU
1. Admin použije `/zabírání_konec`
2. Systém přestane udělovat odměny
3. Zobrazí se konečné statistiky
4. **Zabrané basepointy zůstávají v systému pro příští SSU**

### Příští SSU
1. Při dalším `/zabírání_start` se obnoví udělování odměn
2. Zabrané basepointy z předchozího SSU jsou stále aktivní
3. Pokračuje se tam, kde se skončilo

## Bezpečnost a validace

- **Oprávnění:** Správně kontrolována pro všechny admin commandy
- **Validace obrázků:** Kontrola, že příloha je skutečně obrázek
- **Frakční členství:** Ověření, že uživatel patří do frakce
- **SSU stav:** Controling má přístup k capture funkcím pouze při aktivním SSU
- **Databázová integrita:** Chráněno před SQL injection a chybami

## Možná rozšíření v budoucnu

1. **Časové limity:** Minimální doba mezi zabraními stejného basepoint
2. **Scoring systém:** Různé body za různé typy basepointů
3. **Statistiky:** Podrobnější analýzy výkonu frakcí
4. **Notifikace:** Discord notifikace při zabrání
5. **Import/Export:** Možnost zálohování dat z předchozích SSU
6. **WebUI:** Webové rozhraní pro správu a statistiky

## Troubleshooting

### Časté problémy
1. **"SSU není aktivní"** - Použijte `/zabírání_start` před capturing
2. **"Nejste členem žádné frakce"** - Přidejte si roli frakce
3. **"Příloha musí být obrázek"** - Nahrájte PNG/JPG soubor
4. **"Tento basepoint není povolen"** - Basepoint není v databázi, použijte `/manage_basepoints list`
5. **Autocomplete nefunguje** - Ujistěte se, že máte v databázi přidané basepointy
6. **Odměny se neudělují** - Zkontrolujte, že je SSU aktivní a systém běží

### Logy
- Všechny akce se logují do konzole
- Chybové stavy se zaznamenávají pro debugging
- Úspěšné operace jsou potvrzovány
