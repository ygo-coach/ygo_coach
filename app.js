const STORAGE_KEYS = {
    matches: "ygoCoachMatches",
    tournaments: "ygoCoachTournaments",
    profile: "ygoCoachProfile",
    linkedUser: "ygoCoachLinkedUserId",
    dirtyMatches: "ygoCoachDirtyMatches",
    dirtyTournaments: "ygoCoachDirtyTournaments",
    dirtyProfile: "ygoCoachDirtyProfile",
    deletedMatches: "ygoCoachDeletedMatches",
    deletedTournaments: "ygoCoachDeletedTournaments",
    lastCloudSyncAt: "ygoCoachLastCloudSyncAt",
    opponentDeckCatalog: "ygoCoachOpponentDeckCatalog",
    opponentDeckCatalogRefreshedAt: "ygoCoachOpponentDeckCatalogRefreshedAt",
    cardDatabaseUpdatedAt: "ygoCoachCardDatabaseUpdatedAt"
};

const LEGACY_STORAGE_KEYS = {
    matches: "ygoMatches"
};

const APP_VERSION = "6.5";

const ADMIN_EMAIL = "felixlefevre170@gmail.com";

let matches = loadMatches();
let tournaments = loadArray(STORAGE_KEYS.tournaments);
let profile = normalizeProfile(
    loadObject(STORAGE_KEYS.profile)
);
let opponentDeckCatalog = normalizeOpponentDeckCatalog(
    loadArray(STORAGE_KEYS.opponentDeckCatalog)
);
let editingMatchId = null;
let selectedImportFile = null;

let supabaseClient = null;
let currentUser = null;
let cloudSyncInProgress = false;
let cloudSyncQueued = false;
let cloudSyncTimer = null;
let lastSuccessfulCloudSync = 0;

const FOREGROUND_SYNC_MIN_INTERVAL = 120000;
const OPPONENT_CATALOG_TTL = 6 * 60 * 60 * 1000;
const CARD_DATABASE_TTL = 7 * 24 * 60 * 60 * 1000;
const CARD_DATABASE_NAME = "ygoCoachCardDatabase";
const CARD_DATABASE_STORE = "cards";

let cardDatabase = [];
let cardDatabaseLoadPromise = null;
let deckBuilderDeckId = null;
let cardSearchTimer = null;

function generateId() {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDeckLabel(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeDeckKey(value) {
    return normalizeDeckLabel(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("fr-FR");
}

function normalizeDeckCardEntries(items) {
    const merged = new Map();

    (Array.isArray(items) ? items : [])
        .forEach((item) => {
            if (!item) {
                return;
            }

            const id = Number(
                typeof item === "object"
                    ? item.id
                    : 0
            );

            const name = normalizeDeckLabel(
                typeof item === "string"
                    ? item
                    : item.name
            );

            if (!name) {
                return;
            }

            const key =
                id > 0
                    ? String(id)
                    : normalizeDeckKey(name);

            const previous =
                merged.get(key);

            const qty = Math.max(
                1,
                Math.min(
                    3,
                    Number(
                        typeof item === "object"
                            ? item.qty
                            : 1
                    ) || 1
                )
            );

            if (previous) {
                previous.qty = Math.min(
                    3,
                    previous.qty + qty
                );

                return;
            }

            merged.set(
                key,
                {
                    id:
                        id > 0
                            ? id
                            : key,
                    name,
                    type:
                        typeof item === "object"
                            ? item.type || ""
                            : "",
                    archetype:
                        typeof item === "object"
                            ? item.archetype || ""
                            : "",
                    banTcg:
                        typeof item === "object"
                            ? item.banTcg ||
                                item.ban_tcg ||
                                ""
                            : "",
                    qty
                }
            );
        });

    return Array.from(
        merged.values()
    );
}

function createEmptyDeckList() {
    return {
        mainDeck: [],
        extraDeck: [],
        sideDeck: []
    };
}

function normalizeProfile(source) {
    const base =
        source &&
        typeof source === "object"
            ? { ...source }
            : {};

    const seen = new Set();
    const decks = [];

    const rawDecks = Array.isArray(base.decks)
        ? base.decks
        : [];

    rawDecks.forEach((deck) => {
        const name = normalizeDeckLabel(
            typeof deck === "string"
                ? deck
                : deck?.name
        );

        const key = normalizeDeckKey(name);

        if (!name || seen.has(key)) {
            return;
        }

        seen.add(key);
        decks.push({
            id:
                typeof deck === "object" &&
                deck?.id
                    ? String(deck.id)
                    : generateId(),
            name,
            mainDeck:
                normalizeDeckCardEntries(
                    typeof deck === "object"
                        ? deck?.mainDeck
                        : []
                ),
            extraDeck:
                normalizeDeckCardEntries(
                    typeof deck === "object"
                        ? deck?.extraDeck
                        : []
                ),
            sideDeck:
                normalizeDeckCardEntries(
                    typeof deck === "object"
                        ? deck?.sideDeck
                        : []
                ),
            createdAt:
                typeof deck === "object" &&
                deck?.createdAt
                    ? deck.createdAt
                    : new Date().toISOString(),
            updatedAt:
                typeof deck === "object" &&
                deck?.updatedAt
                    ? deck.updatedAt
                    : null
        });
    });

    const legacyDeck = normalizeDeckLabel(
        base.deck || ""
    );

    if (
        legacyDeck &&
        !seen.has(
            normalizeDeckKey(legacyDeck)
        )
    ) {
        const legacyEntry = {
            id: generateId(),
            name: legacyDeck,
            ...createEmptyDeckList(),
            createdAt: new Date().toISOString(),
            updatedAt: null
        };

        decks.unshift(legacyEntry);
        seen.add(
            normalizeDeckKey(legacyDeck)
        );
    }

    let activeDeckId =
        base.activeDeckId || "";

    if (
        activeDeckId &&
        !decks.some(
            (deck) => deck.id === activeDeckId
        )
    ) {
        activeDeckId = "";
    }

    if (!activeDeckId && legacyDeck) {
        activeDeckId =
            decks.find(
                (deck) =>
                    normalizeDeckKey(deck.name) ===
                    normalizeDeckKey(legacyDeck)
            )?.id || "";
    }

    if (!activeDeckId && decks.length > 0) {
        activeDeckId = decks[0].id;
    }

    const activeDeck = decks.find(
        (deck) => deck.id === activeDeckId
    );

    return {
        ...base,
        decks,
        activeDeckId,
        cardLanguage:
            base.cardLanguage === "en"
                ? "en"
                : "fr",
        deck:
            activeDeck?.name ||
            legacyDeck ||
            ""
    };
}

function normalizeOpponentDeckCatalog(items) {
    const seen = new Set();

    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const name = normalizeDeckLabel(
                typeof item === "string"
                    ? item
                    : item?.name
            );

            return {
                id:
                    typeof item === "object" &&
                    item?.id
                        ? String(item.id)
                        : name,
                name,
                createdAt:
                    typeof item === "object"
                        ? item?.createdAt ||
                            item?.created_at ||
                            null
                        : null
            };
        })
        .filter((item) => {
            const key = normalizeDeckKey(
                item.name
            );

            if (!key || seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        })
        .sort((a, b) =>
            a.name.localeCompare(
                b.name,
                "fr",
                { sensitivity: "base" }
            )
        );
}

function getMyDecks() {
    profile = normalizeProfile(profile);
    return profile.decks;
}

function getActiveMyDeck() {
    const decks = getMyDecks();

    return decks.find(
        (deck) =>
            deck.id === profile.activeDeckId
    ) || decks[0] || null;
}

function ensurePersonalDeck(
    rawName,
    makeActive = false
) {
    const name = normalizeDeckLabel(rawName);

    if (!name) {
        return null;
    }

    profile = normalizeProfile(profile);

    let deck = profile.decks.find(
        (item) =>
            normalizeDeckKey(item.name) ===
            normalizeDeckKey(name)
    );

    if (!deck) {
        deck = {
            id: generateId(),
            name,
            ...createEmptyDeckList(),
            createdAt:
                new Date().toISOString(),
            updatedAt:
                new Date().toISOString()
        };

        profile.decks.push(deck);
    }

    if (
        makeActive ||
        !profile.activeDeckId
    ) {
        profile.activeDeckId = deck.id;
    }

    const activeDeck =
        profile.decks.find(
            (item) =>
                item.id ===
                profile.activeDeckId
        ) || deck;

    profile.deck = activeDeck.name;

    return deck;
}

function getPersonalDeckById(deckId) {
    return getMyDecks().find(
        (deck) =>
            String(deck.id) ===
            String(deckId)
    ) || null;
}

function getPersonalDeckByName(name) {
    const key =
        normalizeDeckKey(name);

    return getMyDecks().find(
        (deck) =>
            normalizeDeckKey(deck.name) ===
            key
    ) || null;
}

function isExtraDeckCardType(type) {
    const normalized =
        String(type || "")
            .toLocaleLowerCase("en-US");

    return [
        "fusion",
        "synchro",
        "xyz",
        "link",
        "lien"
    ].some(
        (keyword) =>
            normalized.includes(keyword)
    );
}

function isDeckBuildableCardType(type) {
    const normalized =
        String(type || "")
            .toLocaleLowerCase("en-US");

    return !(
        normalized.includes("token") ||
        normalized.includes("jeton") ||
        normalized.includes("skill card") ||
        normalized.includes("carte compétence") ||
        normalized.includes("carte competence")
    );
}

function getCardCopyLimit(card) {
    const status =
        String(
            card?.banTcg || ""
        )
            .normalize("NFD")
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .toLocaleLowerCase("fr-FR");

    if (
        status.includes("banned") ||
        status.includes("forbidden") ||
        status.includes("interdit")
    ) {
        return 0;
    }

    if (
        status.includes("semi")
    ) {
        return 2;
    }

    if (
        status.includes("limited") ||
        status.includes("limite")
    ) {
        return 1;
    }

    return 3;
}

function getCardBanLabel(card) {
    const limit =
        getCardCopyLimit(card);

    if (limit === 0) {
        return "INTERDITE";
    }

    if (limit === 1) {
        return "LIMITÉE";
    }

    if (limit === 2) {
        return "SEMI-LIMITÉE";
    }

    return "×3";
}

function deckZoneCount(items) {
    return (Array.isArray(items) ? items : [])
        .reduce(
            (total, item) =>
                total +
                (Number(item.qty) || 0),
            0
        );
}

function getTotalCardQtyInDeck(
    deck,
    cardId
) {
    if (!deck) {
        return 0;
    }

    return [
        deck.mainDeck,
        deck.extraDeck,
        deck.sideDeck
    ]
        .flat()
        .filter(
            (item) =>
                String(item.id) ===
                String(cardId)
        )
        .reduce(
            (total, item) =>
                total +
                (Number(item.qty) || 0),
            0
        );
}

function normalizeCardSearchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .toLocaleLowerCase("fr-FR")
        .trim();
}

function getCardLanguage() {
    return profile?.cardLanguage === "en"
        ? "en"
        : "fr";
}

function getCardLanguageLabel() {
    return getCardLanguage() === "fr"
        ? "Français"
        : "English";
}

function getCardDatabaseUpdatedAtKey() {
    return `${STORAGE_KEYS.cardDatabaseUpdatedAt}:${getCardLanguage()}`;
}

function getLocalizedCard(card) {
    if (!card) {
        return card;
    }

    const localized =
        cardDatabase.find(
            (item) =>
                String(item.id) ===
                String(card.id)
        );

    if (!localized) {
        return card;
    }

    return {
        ...card,
        name:
            localized.name ||
            card.name,
        type:
            localized.type ||
            card.type,
        archetype:
            localized.archetype ||
            card.archetype,
        banTcg:
            localized.banTcg ||
            card.banTcg
    };
}

function localizeSavedDeckCards() {
    if (
        !Array.isArray(cardDatabase) ||
        cardDatabase.length === 0
    ) {
        return false;
    }

    let changed = false;

    getMyDecks().forEach(
        (deck) => {
            [
                "mainDeck",
                "extraDeck",
                "sideDeck"
            ].forEach(
                (zone) => {
                    deck[zone] =
                        deck[zone].map(
                            (card) => {
                                const localized =
                                    getLocalizedCard(
                                        card
                                    );

                                if (
                                    localized.name !== card.name ||
                                    localized.type !== card.type ||
                                    localized.archetype !== card.archetype ||
                                    localized.banTcg !== card.banTcg
                                ) {
                                    changed = true;
                                }

                                return localized;
                            }
                        );
                }
            );
        }
    );

    if (changed) {
        profile.updatedAt =
            new Date().toISOString();

        saveAll();
        markProfileDirty();
    }

    return changed;
}

function updateCardLanguageUi() {
    const language =
        getCardLanguage();

    const select =
        document.getElementById(
            "card-language-select"
        );

    const chip =
        document.getElementById(
            "card-language-chip"
        );

    const search =
        document.getElementById(
            "card-search-input"
        );

    if (select) {
        select.value =
            language;
    }

    if (chip) {
        chip.textContent =
            language.toUpperCase();
    }

    if (search) {
        search.placeholder =
            language === "fr"
                ? "Ex : Floraison de Cendres, Dominus..."
                : "Ex : Ash Blossom, Dominus...";
    }
}

async function setCardLanguage(language) {
    const nextLanguage =
        language === "en"
            ? "en"
            : "fr";

    if (
        getCardLanguage() ===
        nextLanguage
    ) {
        updateCardLanguageUi();
        return;
    }

    profile.cardLanguage =
        nextLanguage;

    profile.updatedAt =
        new Date().toISOString();

    cardDatabase = [];
    cardDatabaseLoadPromise = null;

    saveAll();
    markProfileDirty();

    updateCardLanguageUi();

    updateCardDatabaseStatus(
        `Chargement de la base ${getCardLanguageLabel()}…`
    );

    await refreshCardDatabase();

    localizeSavedDeckCards();

    renderDeckBuilder();
    renderMyDeckLibrary();
    renderMyDeckChoices();
    renderDuelDeckHelpers();
    renderCardSearchResults();
}

function openLocalCardDatabase() {
    return new Promise(
        (resolve, reject) => {
            if (!window.indexedDB) {
                reject(
                    new Error(
                        "IndexedDB indisponible."
                    )
                );

                return;
            }

            const request =
                indexedDB.open(
                    `${CARD_DATABASE_NAME}-${getCardLanguage()}`,
                    1
                );

            request.onupgradeneeded =
                () => {
                    const database =
                        request.result;

                    if (
                        !database.objectStoreNames
                            .contains(
                                CARD_DATABASE_STORE
                            )
                    ) {
                        const store =
                            database.createObjectStore(
                                CARD_DATABASE_STORE,
                                {
                                    keyPath: "id"
                                }
                            );

                        store.createIndex(
                            "name",
                            "name",
                            {
                                unique: false
                            }
                        );
                    }
                };

            request.onsuccess =
                () => resolve(
                    request.result
                );

            request.onerror =
                () => reject(
                    request.error
                );
        }
    );
}

async function readCachedCards() {
    const database =
        await openLocalCardDatabase();

    return new Promise(
        (resolve, reject) => {
            const transaction =
                database.transaction(
                    CARD_DATABASE_STORE,
                    "readonly"
                );

            const request =
                transaction
                    .objectStore(
                        CARD_DATABASE_STORE
                    )
                    .getAll();

            request.onsuccess =
                () => {
                    database.close();

                    resolve(
                        request.result || []
                    );
                };

            request.onerror =
                () => {
                    database.close();

                    reject(
                        request.error
                    );
                };
        }
    );
}

async function writeCachedCards(cards) {
    const database =
        await openLocalCardDatabase();

    return new Promise(
        (resolve, reject) => {
            const transaction =
                database.transaction(
                    CARD_DATABASE_STORE,
                    "readwrite"
                );

            const store =
                transaction.objectStore(
                    CARD_DATABASE_STORE
                );

            store.clear();

            cards.forEach(
                (card) => {
                    store.put(card);
                }
            );

            transaction.oncomplete =
                () => {
                    database.close();
                    resolve();
                };

            transaction.onerror =
                () => {
                    database.close();

                    reject(
                        transaction.error
                    );
                };
        }
    );
}

function normalizeApiCard(card) {
    return {
        id: Number(card.id),
        name:
            normalizeDeckLabel(
                card.name
            ),
        type: card.type || "",
        race: card.race || "",
        archetype:
            card.archetype || "",
        banTcg:
            card.banlist_info
                ?.ban_tcg || ""
    };
}

function updateCardDatabaseStatus(
    message,
    isError = false
) {
    const element =
        document.getElementById(
            "card-database-status"
        );

    if (!element) {
        return;
    }

    element.textContent =
        message;

    element.classList.toggle(
        "inline-error",
        isError
    );
}

async function refreshCardDatabase(
    force = false
) {
    if (
        cardDatabaseLoadPromise &&
        !force
    ) {
        return cardDatabaseLoadPromise;
    }

    cardDatabaseLoadPromise =
        (async () => {
            const updatedAt =
                Number(
                    localStorage.getItem(
                        getCardDatabaseUpdatedAtKey()
                    ) || 0
                );

            let cachedCards = [];

            try {
                cachedCards =
                    await readCachedCards();
            } catch (error) {
                console.warn(
                    "Cache cartes TCG indisponible",
                    error
                );
            }

            if (
                !force &&
                cachedCards.length > 0
            ) {
                cardDatabase =
                    cachedCards;

                const age =
                    Date.now() -
                    updatedAt;

                if (
                    age <
                    CARD_DATABASE_TTL ||
                    !navigator.onLine
                ) {
                    updateCardDatabaseStatus(
                        `${cardDatabase.length} cartes TCG • ${getCardLanguageLabel()} • en cache.`
                    );

                    localizeSavedDeckCards();

                    return cardDatabase;
                }
            }

            if (!navigator.onLine) {
                if (
                    cardDatabase.length === 0
                ) {
                    updateCardDatabaseStatus(
                        "Aucune base de cartes hors ligne. Connecte-toi une première fois.",
                        true
                    );
                }

                return cardDatabase;
            }

            updateCardDatabaseStatus(
                `Mise à jour de la base TCG • ${getCardLanguageLabel()}…`
            );

            const language =
                getCardLanguage();

            const apiUrl =
                language === "fr"
                    ? "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=tcg&language=fr"
                    : "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=tcg";

            const response =
                await fetch(
                    apiUrl
                );

            if (!response.ok) {
                throw new Error(
                    `YGOPRODeck HTTP ${response.status}`
                );
            }

            const payload =
                await response.json();

            const cards =
                Array.isArray(
                    payload?.data
                )
                    ? payload.data
                        .map(
                            normalizeApiCard
                        )
                        .filter(
                            (card) =>
                                card.id &&
                                card.name &&
                                isDeckBuildableCardType(
                                    card.type
                                )
                        )
                        .sort(
                            (a, b) =>
                                a.name.localeCompare(
                                    b.name,
                                    getCardLanguage(),
                                    {
                                        sensitivity:
                                            "base"
                                    }
                                )
                        )
                    : [];

            if (
                cards.length === 0
            ) {
                throw new Error(
                    "La base TCG reçue est vide."
                );
            }

            cardDatabase =
                cards;

            try {
                await writeCachedCards(
                    cards
                );

                localStorage.setItem(
                    getCardDatabaseUpdatedAtKey(),
                    String(Date.now())
                );
            } catch (error) {
                console.warn(
                    "Impossible de mettre en cache les cartes",
                    error
                );
            }

            updateCardDatabaseStatus(
                `${cards.length} cartes TCG • ${getCardLanguageLabel()} • à jour.`
            );

            localizeSavedDeckCards();

            return cards;
        })()
            .catch(
                (error) => {
                    console.error(
                        "Base YGOPRODeck",
                        error
                    );

                    updateCardDatabaseStatus(
                        cardDatabase.length > 0
                            ? `Mise à jour impossible. ${cardDatabase.length} cartes restent disponibles en cache.`
                            : "Impossible de charger la base de cartes TCG.",
                        true
                    );

                    return cardDatabase;
                }
            )
            .finally(
                () => {
                    cardDatabaseLoadPromise =
                        null;
                }
            );

    return cardDatabaseLoadPromise;
}

function getDeckBuilderDeck() {
    return getPersonalDeckById(
        deckBuilderDeckId
    );
}

function openDeckBuilder(deckId) {
    const deck =
        getPersonalDeckById(
            deckId
        );

    if (!deck) {
        return;
    }

    deckBuilderDeckId =
        deck.id;

    const panel =
        document.getElementById(
            "deck-builder-panel"
        );

    panel?.classList.remove(
        "hidden"
    );

    renderDeckBuilder();

    refreshCardDatabase()
        .then(
            () => {
                renderDeckBuilder();
                renderCardSearchResults();
            }
        );

    window.setTimeout(
        () => {
            panel?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        },
        80
    );
}

function closeDeckBuilder() {
    deckBuilderDeckId =
        null;

    document
        .getElementById(
            "deck-builder-panel"
        )
        ?.classList.add(
            "hidden"
        );

    const results =
        document.getElementById(
            "card-search-results"
        );

    if (results) {
        results.innerHTML = "";
    }
}

function getDeckValidation(deck) {
    if (!deck) {
        return {
            legal: false,
            messages: [
                "Aucun deck sélectionné."
            ]
        };
    }

    const messages = [];

    const mainCount =
        deckZoneCount(
            deck.mainDeck
        );

    const extraCount =
        deckZoneCount(
            deck.extraDeck
        );

    const sideCount =
        deckZoneCount(
            deck.sideDeck
        );

    if (
        mainCount < 40 ||
        mainCount > 60
    ) {
        messages.push(
            `Main Deck : ${mainCount}/40–60`
        );
    }

    if (extraCount > 15) {
        messages.push(
            `Extra Deck : ${extraCount}/15`
        );
    }

    if (sideCount > 15) {
        messages.push(
            `Side Deck : ${sideCount}/15`
        );
    }

    const allCards = [
        ...deck.mainDeck,
        ...deck.extraDeck,
        ...deck.sideDeck
    ];

    const uniqueIds =
        Array.from(
            new Set(
                allCards.map(
                    (card) =>
                        String(card.id)
                )
            )
        );

    uniqueIds.forEach(
        (cardId) => {
            const card =
                allCards.find(
                    (item) =>
                        String(item.id) ===
                        cardId
                );

            const qty =
                getTotalCardQtyInDeck(
                    deck,
                    cardId
                );

            const limit =
                getCardCopyLimit(
                    card
                );

            if (qty > limit) {
                messages.push(
                    `${card.name} : ${qty}/${limit}`
                );
            }
        }
    );

    deck.mainDeck.forEach(
        (card) => {
            if (
                isExtraDeckCardType(
                    card.type
                )
            ) {
                messages.push(
                    `${card.name} doit être dans l'Extra Deck.`
                );
            }
        }
    );

    deck.extraDeck.forEach(
        (card) => {
            if (
                !isExtraDeckCardType(
                    card.type
                )
            ) {
                messages.push(
                    `${card.name} ne peut pas être dans l'Extra Deck.`
                );
            }
        }
    );

    return {
        legal:
            messages.length === 0,
        messages
    };
}

function renderDeckBuilder() {
    const deck =
        getDeckBuilderDeck();

    const panel =
        document.getElementById(
            "deck-builder-panel"
        );

    if (
        !panel ||
        !deck
    ) {
        panel?.classList.add(
            "hidden"
        );

        return;
    }

    panel.classList.remove(
        "hidden"
    );

    document.getElementById(
        "deck-builder-name"
    ).textContent =
        deck.name;

    const mainCount =
        deckZoneCount(
            deck.mainDeck
        );

    const extraCount =
        deckZoneCount(
            deck.extraDeck
        );

    const sideCount =
        deckZoneCount(
            deck.sideDeck
        );

    document.getElementById(
        "main-deck-count"
    ).textContent =
        `${mainCount} / 40–60`;

    document.getElementById(
        "extra-deck-count"
    ).textContent =
        `${extraCount} / 15`;

    document.getElementById(
        "side-deck-count"
    ).textContent =
        `${sideCount} / 15`;

    renderDeckZone(
        "main-deck-list",
        deck.mainDeck,
        "mainDeck"
    );

    renderDeckZone(
        "extra-deck-list",
        deck.extraDeck,
        "extraDeck"
    );

    renderDeckZone(
        "side-deck-list",
        deck.sideDeck,
        "sideDeck"
    );

    const validation =
        getDeckValidation(deck);

    const legality =
        document.getElementById(
            "deck-builder-legality"
        );

    if (validation.legal) {
        legality.textContent =
            `Deck prêt • ${mainCount} Main • ${extraCount} Extra • ${sideCount} Side`;

        legality.classList.add(
            "legal"
        );

        legality.classList.remove(
            "illegal"
        );
    } else {
        legality.textContent =
            validation.messages
                .slice(0, 3)
                .join(" • ");

        legality.classList.add(
            "illegal"
        );

        legality.classList.remove(
            "legal"
        );
    }

    renderDuelDeckHelpers();
}

function renderDeckZone(
    elementId,
    cards,
    zone
) {
    const container =
        document.getElementById(
            elementId
        );

    if (!container) {
        return;
    }

    if (
        !Array.isArray(cards) ||
        cards.length === 0
    ) {
        container.innerHTML = `
            <div class="empty-state compact-empty-state">
                Aucune carte.
            </div>
        `;

        return;
    }

    container.innerHTML =
        cards
            .map(
                (card) =>
                    getLocalizedCard(card)
            )
            .slice()
            .sort(
                (a, b) =>
                    a.name.localeCompare(
                        b.name,
                        getCardLanguage(),
                        {
                            sensitivity:
                                "base"
                        }
                    )
            )
            .map(
                (card) => `
                    <article class="deck-card-row">
                        <div class="deck-card-copy">
                            <strong>${escapeHtml(card.name)}</strong>
                            <small>
                                ${escapeHtml(card.type || "Carte")}
                                ${card.banTcg ? ` • ${escapeHtml(getCardBanLabel(card))}` : ""}
                            </small>
                        </div>

                        <div class="deck-card-qty">
                            <button
                                type="button"
                                data-deck-card-action="minus"
                                data-zone="${escapeHtml(zone)}"
                                data-card-id="${escapeHtml(card.id)}"
                                aria-label="Retirer une copie"
                            >
                                −
                            </button>

                            <strong>${Number(card.qty) || 1}</strong>

                            <button
                                type="button"
                                data-deck-card-action="plus"
                                data-zone="${escapeHtml(zone)}"
                                data-card-id="${escapeHtml(card.id)}"
                                aria-label="Ajouter une copie"
                            >
                                +
                            </button>
                        </div>
                    </article>
                `
            )
            .join("");
}

function renderCardSearchResults() {
    const results =
        document.getElementById(
            "card-search-results"
        );

    const input =
        document.getElementById(
            "card-search-input"
        );

    if (
        !results ||
        !input
    ) {
        return;
    }

    const query =
        normalizeCardSearchText(
            input.value
        );

    if (query.length < 2) {
        results.innerHTML = "";

        return;
    }

    if (
        cardDatabase.length === 0
    ) {
        results.innerHTML = `
            <div class="empty-state compact-empty-state">
                Chargement de la base TCG…
            </div>
        `;

        refreshCardDatabase()
            .then(
                renderCardSearchResults
            );

        return;
    }

    const matches =
        cardDatabase
            .filter(
                (card) =>
                    normalizeCardSearchText(
                        card.name
                    )
                        .includes(query)
            )
            .sort(
                (a, b) => {
                    const aName =
                        normalizeCardSearchText(
                            a.name
                        );

                    const bName =
                        normalizeCardSearchText(
                            b.name
                        );

                    const aStarts =
                        aName.startsWith(
                            query
                        );

                    const bStarts =
                        bName.startsWith(
                            query
                        );

                    if (
                        aStarts !== bStarts
                    ) {
                        return aStarts
                            ? -1
                            : 1;
                    }

                    return a.name.localeCompare(
                        b.name,
                        getCardLanguage()
                    );
                }
            )
            .slice(0, 12);

    if (matches.length === 0) {
        results.innerHTML = `
            <div class="empty-state compact-empty-state">
                Aucune carte TCG trouvée.
            </div>
        `;

        return;
    }

    results.innerHTML =
        matches
            .map(
                (card) => `
                    <button
                        type="button"
                        class="card-search-result"
                        data-add-card-id="${escapeHtml(card.id)}"
                    >
                        <span>
                            <strong>${escapeHtml(card.name)}</strong>
                            <small>
                                ${escapeHtml(card.type || "Carte")}
                                ${card.archetype ? ` • ${escapeHtml(card.archetype)}` : ""}
                            </small>
                        </span>

                        <span class="banlist-pill ${getCardCopyLimit(card) === 0 ? "forbidden" : ""}">
                            ${escapeHtml(getCardBanLabel(card))}
                        </span>
                    </button>
                `
            )
            .join("");
}

function saveDeckBuilderChange(deck) {
    if (!deck) {
        return;
    }

    deck.updatedAt =
        new Date().toISOString();

    profile.updatedAt =
        deck.updatedAt;

    saveAll();
    markProfileDirty();

    renderDeckBuilder();
    renderMyDeckLibrary();
    renderMyDeckChoices();
}

function addCardToDeckBuilder(
    cardId
) {
    const deck =
        getDeckBuilderDeck();

    const zone =
        document.getElementById(
            "deck-builder-zone"
        )?.value || "mainDeck";

    const card =
        cardDatabase.find(
            (item) =>
                String(item.id) ===
                String(cardId)
        );

    if (
        !deck ||
        !card
    ) {
        return;
    }

    const copyLimit =
        getCardCopyLimit(card);

    if (copyLimit === 0) {
        window.alert(
            `${card.name} est interdite sur la banlist TCG actuelle.`
        );

        return;
    }

    if (
        zone === "extraDeck" &&
        !isExtraDeckCardType(
            card.type
        )
    ) {
        window.alert(
            `${card.name} n'est pas une carte d'Extra Deck.`
        );

        return;
    }

    if (
        zone === "mainDeck" &&
        isExtraDeckCardType(
            card.type
        )
    ) {
        window.alert(
            `${card.name} doit être ajoutée dans l'Extra Deck ou le Side Deck.`
        );

        return;
    }

    const zoneLimit =
        zone === "mainDeck"
            ? 60
            : 15;

    if (
        deckZoneCount(
            deck[zone]
        ) >= zoneLimit
    ) {
        window.alert(
            zone === "mainDeck"
                ? "Le Main Deck ne peut pas dépasser 60 cartes."
                : "Cette zone ne peut pas dépasser 15 cartes."
        );

        return;
    }

    const currentTotal =
        getTotalCardQtyInDeck(
            deck,
            card.id
        );

    if (
        currentTotal >=
        copyLimit
    ) {
        window.alert(
            `${card.name} est limitée à ${copyLimit} exemplaire${copyLimit > 1 ? "s" : ""} au total.`
        );

        return;
    }

    const existing =
        deck[zone].find(
            (item) =>
                String(item.id) ===
                String(card.id)
        );

    if (existing) {
        existing.qty += 1;
    } else {
        deck[zone].push({
            ...card,
            qty: 1
        });
    }

    saveDeckBuilderChange(
        deck
    );
}

function changeDeckCardQuantity(
    zone,
    cardId,
    delta
) {
    const deck =
        getDeckBuilderDeck();

    if (
        !deck ||
        !Array.isArray(
            deck[zone]
        )
    ) {
        return;
    }

    const card =
        deck[zone].find(
            (item) =>
                String(item.id) ===
                String(cardId)
        );

    if (!card) {
        return;
    }

    if (delta > 0) {
        const copyLimit =
            getCardCopyLimit(
                card
            );

        const zoneLimit =
            zone === "mainDeck"
                ? 60
                : 15;

        if (
            deckZoneCount(
                deck[zone]
            ) >= zoneLimit
        ) {
            return;
        }

        if (
            getTotalCardQtyInDeck(
                deck,
                card.id
            ) >= copyLimit
        ) {
            return;
        }

        card.qty += 1;
    } else {
        card.qty -= 1;

        if (card.qty <= 0) {
            deck[zone] =
                deck[zone].filter(
                    (item) =>
                        String(item.id) !==
                        String(cardId)
                );
        }
    }

    saveDeckBuilderChange(
        deck
    );
}

function getCurrentMatchDeck() {
    const name =
        document.getElementById(
            "my-deck"
        )?.value || "";

    return getPersonalDeckByName(
        name
    );
}

function countNames(items) {
    const counts =
        new Map();

    (Array.isArray(items) ? items : [])
        .forEach(
            (name) => {
                const key =
                    normalizeDeckKey(
                        name
                    );

                counts.set(
                    key,
                    (counts.get(key) || 0) +
                        1
                );
            }
        );

    return counts;
}

function buildRepeatedNames(
    existingNames,
    cardName,
    maxQty
) {
    const current =
        Array.isArray(existingNames)
            ? existingNames
            : [];

    const key =
        normalizeDeckKey(
            cardName
        );

    const sameCount =
        current.filter(
            (name) =>
                normalizeDeckKey(
                    name
                ) === key
        ).length;

    const without =
        current.filter(
            (name) =>
                normalizeDeckKey(
                    name
                ) !== key
        );

    const nextQty =
        sameCount >= maxQty
            ? 0
            : sameCount + 1;

    for (
        let index = 0;
        index < nextQty;
        index += 1
    ) {
        without.push(
            cardName
        );
    }

    return without;
}

function getSideSourceCards(
    deck,
    direction
) {
    if (!deck) {
        return [];
    }

    const source =
        (
            direction === "in"
                ? deck.sideDeck
                : [
                    ...deck.mainDeck,
                    ...deck.extraDeck
                ]
        ).map(
            (card) =>
                getLocalizedCard(card)
        );

    const merged =
        new Map();

    source.forEach(
        (card) => {
            const key =
                String(card.id);

            if (
                merged.has(key)
            ) {
                merged.get(key).qty +=
                    Number(card.qty) || 0;
            } else {
                merged.set(
                    key,
                    {
                        ...card,
                        qty:
                            Number(card.qty) || 1
                    }
                );
            }
        }
    );

    return Array.from(
        merged.values()
    );
}

function renderSideAssistant(
    gameNumber
) {
    const deck =
        getCurrentMatchDeck();

    ["in", "out"].forEach(
        (direction) => {
            const container =
                document.getElementById(
                    `g${gameNumber}-side-${direction}-options`
                );

            const textarea =
                document.getElementById(
                    `g${gameNumber}-side-${direction}`
                );

            if (
                !container ||
                !textarea
            ) {
                return;
            }

            if (!deck) {
                container.innerHTML = `
                    <span class="helper-empty">
                        Construis ce deck dans Profil pour utiliser le side rapide.
                    </span>
                `;

                return;
            }

            const cards =
                getSideSourceCards(
                    deck,
                    direction
                );

            if (
                cards.length === 0
            ) {
                container.innerHTML = `
                    <span class="helper-empty">
                        Aucune carte disponible.
                    </span>
                `;

                return;
            }

            const selected =
                countNames(
                    parseCardList(
                        textarea.value
                    )
                );

            container.innerHTML =
                cards
                    .slice()
                    .sort(
                        (a, b) =>
                            a.name.localeCompare(
                                b.name,
                                getCardLanguage()
                            )
                    )
                    .map(
                        (card) => {
                            const qty =
                                selected.get(
                                    normalizeDeckKey(
                                        card.name
                                    )
                                ) || 0;

                            return `
                                <button
                                    type="button"
                                    class="side-card-chip ${qty > 0 ? "selected" : ""}"
                                    data-side-game="${gameNumber}"
                                    data-side-direction="${direction}"
                                    data-side-card-id="${escapeHtml(card.id)}"
                                >
                                    ${escapeHtml(card.name)}
                                    <span>${qty > 0 ? `×${qty}` : `0/${card.qty}`}</span>
                                </button>
                            `;
                        }
                    )
                    .join("");
        }
    );
}

function getEffectiveMainDeckForGame(
    gameNumber
) {
    const deck =
        getCurrentMatchDeck();

    if (!deck) {
        return [];
    }

    const map =
        new Map();

    deck.mainDeck
        .map(
            (card) =>
                getLocalizedCard(card)
        )
        .forEach(
        (card) => {
            map.set(
                normalizeDeckKey(
                    card.name
                ),
                {
                    ...card,
                    qty:
                        Number(card.qty) || 1
                }
            );
        }
    );

    if (
        gameNumber >= 2
    ) {
        const sideOut =
            parseCardList(
                document.getElementById(
                    `g${gameNumber}-side-out`
                )?.value || ""
            );

        const sideIn =
            parseCardList(
                document.getElementById(
                    `g${gameNumber}-side-in`
                )?.value || ""
            );

        sideOut.forEach(
            (name) => {
                const key =
                    normalizeDeckKey(
                        name
                    );

                const card =
                    map.get(key);

                if (!card) {
                    return;
                }

                card.qty -= 1;

                if (
                    card.qty <= 0
                ) {
                    map.delete(key);
                }
            }
        );

        sideIn.forEach(
            (name) => {
                const sourceCard =
                    deck.sideDeck
                        .map(
                            (card) =>
                                getLocalizedCard(card)
                        )
                        .find(
                        (card) =>
                            normalizeDeckKey(
                                card.name
                            ) ===
                            normalizeDeckKey(
                                name
                            )
                    );

                if (
                    !sourceCard ||
                    isExtraDeckCardType(
                        sourceCard.type
                    )
                ) {
                    return;
                }

                const key =
                    normalizeDeckKey(
                        sourceCard.name
                    );

                const existing =
                    map.get(key);

                if (existing) {
                    existing.qty += 1;
                } else {
                    map.set(
                        key,
                        {
                            ...sourceCard,
                            qty: 1
                        }
                    );
                }
            }
        );
    }

    return Array.from(
        map.values()
    );
}

function renderOpeningHandPicker(
    gameNumber
) {
    const container =
        document.getElementById(
            `g${gameNumber}-hand-options`
        );

    const input =
        document.getElementById(
            `g${gameNumber}-opening-hand`
        );

    if (
        !container ||
        !input
    ) {
        return;
    }

    const cards =
        getEffectiveMainDeckForGame(
            gameNumber
        );

    if (
        cards.length === 0
    ) {
        container.innerHTML = `
            <span class="helper-empty">
                Construis le Main Deck dans Profil pour saisir la main par clic.
            </span>
        `;

        return;
    }

    const selectedNames =
        parseCardList(
            input.value
        );

    const selected =
        countNames(
            selectedNames
        );

    const totalSelected =
        selectedNames.length;

    container.innerHTML = `
        <div class="hand-picker-counter">
            ${totalSelected} / 5 cartes
        </div>

        <div class="hand-picker-chips">
            ${cards
                .slice()
                .sort(
                    (a, b) =>
                        a.name.localeCompare(
                            b.name,
                            "en"
                        )
                )
                .map(
                    (card) => {
                        const qty =
                            selected.get(
                                normalizeDeckKey(
                                    card.name
                                )
                            ) || 0;

                        return `
                            <button
                                type="button"
                                class="hand-card-chip ${qty > 0 ? "selected" : ""}"
                                data-hand-game="${gameNumber}"
                                data-hand-card-id="${escapeHtml(card.id)}"
                            >
                                ${escapeHtml(card.name)}
                                <span>${qty > 0 ? `×${qty}` : ""}</span>
                            </button>
                        `;
                    }
                )
                .join("")}
        </div>
    `;
}

function renderDuelDeckHelpers() {
    renderSideAssistant(2);
    renderSideAssistant(3);

    renderOpeningHandPicker(1);
    renderOpeningHandPicker(2);
    renderOpeningHandPicker(3);
}

function cycleSideCardSelection(
    gameNumber,
    direction,
    cardId
) {
    const deck =
        getCurrentMatchDeck();

    if (!deck) {
        return;
    }

    const card =
        getSideSourceCards(
            deck,
            direction
        ).find(
            (item) =>
                String(item.id) ===
                String(cardId)
        );

    const textarea =
        document.getElementById(
            `g${gameNumber}-side-${direction}`
        );

    if (
        !card ||
        !textarea
    ) {
        return;
    }

    const current =
        parseCardList(
            textarea.value
        );

    const next =
        buildRepeatedNames(
            current,
            card.name,
            Number(card.qty) || 1
        );

    textarea.value =
        next.join("; ");

    renderSideAssistant(
        gameNumber
    );

    renderOpeningHandPicker(
        gameNumber
    );
}

function cycleOpeningHandCard(
    gameNumber,
    cardId
) {
    const input =
        document.getElementById(
            `g${gameNumber}-opening-hand`
        );

    if (!input) {
        return;
    }

    const cards =
        getEffectiveMainDeckForGame(
            gameNumber
        );

    const card =
        cards.find(
            (item) =>
                String(item.id) ===
                String(cardId)
        );

    if (!card) {
        return;
    }

    const current =
        parseCardList(
            input.value
        );

    const key =
        normalizeDeckKey(
            card.name
        );

    const currentQty =
        current.filter(
            (name) =>
                normalizeDeckKey(
                    name
                ) === key
        ).length;

    const without =
        current.filter(
            (name) =>
                normalizeDeckKey(
                    name
                ) !== key
        );

    let nextQty =
        currentQty + 1;

    if (
        current.length >= 5 &&
        currentQty > 0
    ) {
        nextQty = 0;
    } else if (
        current.length >= 5
    ) {
        return;
    } else if (
        nextQty >
        (Number(card.qty) || 1)
    ) {
        nextQty = 0;
    }

    const next = [
        ...without
    ];

    for (
        let index = 0;
        index < nextQty;
        index += 1
    ) {
        if (
            next.length >= 5
        ) {
            break;
        }

        next.push(
            card.name
        );
    }

    input.value =
        next.join("; ");

    renderOpeningHandPicker(
        gameNumber
    );
}

function buildOpeningHandInsight(
    allGames
) {
    const firstGames =
        allGames.filter(
            (game) =>
                game.position === "first" &&
                Array.isArray(
                    game.openingHand
                ) &&
                game.openingHand.length >= 5 &&
                (
                    game.result === "win" ||
                    game.result === "loss"
                )
        );

    if (
        firstGames.length < 5
    ) {
        return "";
    }

    const stats =
        new Map();

    firstGames.forEach(
        (game) => {
            const uniqueCards =
                Array.from(
                    new Set(
                        game.openingHand.map(
                            normalizeDeckKey
                        )
                    )
                );

            uniqueCards.forEach(
                (key) => {
                    if (
                        !stats.has(key)
                    ) {
                        stats.set(
                            key,
                            {
                                name:
                                    game.openingHand.find(
                                        (name) =>
                                            normalizeDeckKey(
                                                name
                                            ) === key
                                    ),
                                games: 0,
                                wins: 0
                            }
                        );
                    }

                    const item =
                        stats.get(key);

                    item.games += 1;

                    if (
                        game.result === "win"
                    ) {
                        item.wins += 1;
                    }
                }
            );
        }
    );

    const candidates =
        Array.from(
            stats.values()
        )
            .filter(
                (item) =>
                    item.games >= 3
            )
            .map(
                (item) => ({
                    ...item,
                    winrate:
                        percentage(
                            item.wins,
                            item.games
                        )
                })
            )
            .sort(
                (a, b) =>
                    b.winrate -
                    a.winrate ||
                    b.games -
                    a.games
            );

    const best =
        candidates[0];

    if (!best) {
        return "";
    }

    return `Main de départ : en commençant, tes meilleurs résultats observés sont avec ${best.name} en main (${best.winrate} % sur ${best.games} games). Continue d'enregistrer tes mains pour fiabiliser l'analyse.`;
}

function saveOpponentDeckCatalog() {
    localStorage.setItem(
        STORAGE_KEYS.opponentDeckCatalog,
        JSON.stringify(opponentDeckCatalog)
    );
}

function loadArray(key) {
    try {
        const rawValue = localStorage.getItem(key);

        if (!rawValue) {
            return [];
        }

        const parsedValue = JSON.parse(rawValue);

        return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
        console.error(`Impossible de lire ${key}`, error);
        return [];
    }
}

function loadObject(key) {
    try {
        const rawValue = localStorage.getItem(key);

        if (!rawValue) {
            return {};
        }

        const parsedValue = JSON.parse(rawValue);

        return parsedValue && typeof parsedValue === "object"
            ? parsedValue
            : {};
    } catch (error) {
        console.error(`Impossible de lire ${key}`, error);
        return {};
    }
}

function loadMatches() {
    let currentMatches = loadArray(STORAGE_KEYS.matches);

    if (currentMatches.length === 0) {
        const legacyMatches = loadArray(
            LEGACY_STORAGE_KEYS.matches
        );

        if (legacyMatches.length > 0) {
            currentMatches = legacyMatches;

            localStorage.setItem(
                STORAGE_KEYS.matches,
                JSON.stringify(currentMatches)
            );
        }
    }

    return currentMatches.map(normalizeMatch);
}

function normalizeMatch(match) {
    return {
        id: match.id || generateId(),
        myDeck: match.myDeck || "",
        opponentDeck:
            match.opponentDeck ||
            match.opponent ||
            "Deck inconnu",
        result: match.result || "loss",
        score:
            match.score ||
            (
                match.result === "win"
                    ? "2-1"
                    : "1-2"
            ),
        dice: match.dice || "loss",
        position:
            match.position ||
            getLegacyGameOnePosition(match) ||
            "second",
        tournamentId: match.tournamentId || "",
        mistakeType: match.mistakeType || "",
        note: match.note || "",
        games: normalizeGames(match.games),
        createdAt:
            match.createdAt ||
            match.date ||
            new Date().toISOString(),
        updatedAt: match.updatedAt || null
    };
}

function getLegacyGameOnePosition(match) {
    if (
        Array.isArray(match.games) &&
        match.games.length > 0
    ) {
        return match.games[0].position || "";
    }

    return "";
}

function normalizeGames(games) {
    if (!Array.isArray(games)) {
        return [];
    }

    return games
        .filter((game) => game && game.played !== false)
        .map((game, index) => ({
            number: Number(game.number) || index + 1,
            played: true,
            position: game.position || "",
            result: game.result || "",
            reason:
                game.reason ||
                game.mistakeType ||
                "",
            sideIn: Array.isArray(game.sideIn)
                ? game.sideIn
                : parseCardList(game.sideIn || ""),
            sideOut: Array.isArray(game.sideOut)
                ? game.sideOut
                : parseCardList(game.sideOut || ""),
            openingHand:
                Array.isArray(game.openingHand)
                    ? game.openingHand
                    : parseCardList(
                        game.openingHand || ""
                    ),
            note: game.note || ""
        }));
}

function saveAll() {
    localStorage.setItem(
        STORAGE_KEYS.matches,
        JSON.stringify(matches)
    );

    localStorage.setItem(
        STORAGE_KEYS.tournaments,
        JSON.stringify(tournaments)
    );

    localStorage.setItem(
        STORAGE_KEYS.profile,
        JSON.stringify(profile)
    );
}

function parseCardList(value) {
    const text =
        String(value || "")
            .trim();

    if (!text) {
        return [];
    }

    const separator =
        /[;\n]/.test(text)
            ? /[;\n]/
            : /,/;

    return text
        .split(separator)
        .map(
            (item) =>
                item.trim()
        )
        .filter(Boolean);
}

function percentage(part, total) {
    if (total === 0) {
        return null;
    }

    return Math.round((part / total) * 100);
}

function winrateForMatches(list) {
    const wins = list.filter(
        (match) => match.result === "win"
    ).length;

    return percentage(wins, list.length);
}

function winrateForGames(list) {
    const validGames = list.filter(
        (game) =>
            game.result === "win" ||
            game.result === "loss"
    );

    const wins = validGames.filter(
        (game) => game.result === "win"
    ).length;

    return percentage(wins, validGames.length);
}

function formatPercent(value) {
    return value === null ? "-" : `${value} %`;
}

function formatDate(isoDate) {
    const date = new Date(isoDate);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit"
    }).format(date);
}

function getAllGames() {
    return matches.flatMap((match) => {
        return match.games.map((game) => ({
            ...game,
            matchId: match.id,
            opponentDeck: match.opponentDeck,
            myDeck: match.myDeck,
            tournamentId: match.tournamentId
        }));
    });
}

function goToPage(pageName) {
    document.querySelectorAll(".page").forEach((page) => {
        page.classList.remove("active");
    });

    document.querySelectorAll(".nav-button").forEach((button) => {
        button.classList.remove("active");
    });

    const page = document.getElementById(`page-${pageName}`);
    const navButton = document.querySelector(
        `.nav-button[data-page="${pageName}"]`
    );

    if (page) {
        page.classList.add("active");
    }

    if (navButton) {
        navButton.classList.add("active");
    }

    if (
        pageName === "add" &&
        !editingMatchId
    ) {
        const myDeckInput =
            document.getElementById(
                "my-deck"
            );

        if (
            myDeckInput &&
            !myDeckInput.value.trim()
        ) {
            const activeDeck =
                getActiveMyDeck();

            if (activeDeck) {
                myDeckInput.value =
                    activeDeck.name;
            }
        }

        renderMyDeckChoices();
        renderDuelDeckHelpers();
    }

    if (pageName === "profile") {
        refreshOpponentDeckCatalog();
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


function isSupabaseConfigured() {
    const config = window.YGO_CONFIG || {};

    return Boolean(
        window.supabase &&
        config.supabaseUrl &&
        config.supabaseKey &&
        /^https:\/\//.test(config.supabaseUrl) &&
        config.supabaseKey.length > 20
    );
}

function initializeSupabaseClient() {
    if (!isSupabaseConfigured()) {
        renderAccountState();
        renderTopAccountButton();
        return false;
    }

    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(
            window.YGO_CONFIG.supabaseUrl,
            window.YGO_CONFIG.supabaseKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );
    }

    return true;
}

async function initializeCloudAuth() {
    if (!initializeSupabaseClient()) {
        renderOpponentCatalogSummary();
        return;
    }

    refreshOpponentDeckCatalog();

    lastSuccessfulCloudSync =
        Number(
            localStorage.getItem(
                STORAGE_KEYS.lastCloudSyncAt
            )
        ) || 0;

    const {
        data,
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        console.error(error);

        showAccountStatus(
            "Impossible de lire la session Supabase.",
            true
        );
    }

    await applySession(
        data?.session || null,
        false
    );

    supabaseClient.auth.onAuthStateChange(
        async (event, session) => {
            if (event === "PASSWORD_RECOVERY") {
                const newPassword = window.prompt(
                    "Choisis ton nouveau mot de passe (6 caractères minimum) :"
                );

                if (
                    newPassword &&
                    newPassword.length >= 6
                ) {
                    const {
                        error: updateError
                    } = await supabaseClient.auth.updateUser({
                        password: newPassword
                    });

                    if (updateError) {
                        showAccountStatus(
                            updateError.message,
                            true
                        );
                    } else {
                        showAccountStatus(
                            "Mot de passe modifié."
                        );
                    }
                }
            }

            await applySession(
                session,
                event === "SIGNED_IN"
            );
        }
    );

    document.addEventListener(
        "visibilitychange",
        () => {
            if (
                document.visibilityState === "visible"
            ) {
                syncOnForeground();
            }
        }
    );

    window.addEventListener(
        "focus",
        syncOnForeground
    );

    window.addEventListener(
        "online",
        () => {
            renderTopAccountButton();

            if (currentUser) {
                requestCloudSync(300);
            }
        }
    );

    window.addEventListener(
        "offline",
        () => {
            renderTopAccountButton();

            if (currentUser) {
                setCloudStatus(
                    "local",
                    "Hors ligne",
                    "Les modifications restent enregistrées localement."
                );
            }
        }
    );
}

function syncOnForeground() {
    if (
        !currentUser ||
        !supabaseClient ||
        !navigator.onLine
    ) {
        return;
    }

    const elapsed =
        Date.now() -
        lastSuccessfulCloudSync;

    if (
        elapsed >=
        FOREGROUND_SYNC_MIN_INTERVAL
    ) {
        requestCloudSync(300);
    }
}

async function applySession(
    session,
    syncImmediately
) {
    const nextUser =
        session?.user || null;

    const changedUser =
        nextUser?.id !== currentUser?.id;

    currentUser = nextUser;

    renderAccountState();
    renderProfile();

    if (!currentUser) {
        renderTopAccountButton();
        return;
    }

    setCloudStatus(
        "syncing",
        "Cloud…"
    );

    if (
        changedUser ||
        syncImmediately
    ) {
        await syncWithCloud("login");
    } else {
        requestCloudSync(250);
    }
}

function isAdminUser() {
    return Boolean(
        currentUser?.email &&
        currentUser.email
            .trim()
            .toLowerCase() === ADMIN_EMAIL
    );
}

function renderRoleVisibility() {
    const accountPanel =
        document.getElementById(
            "account-panel"
        );

    const backupPanel =
        document.getElementById(
            "backup-panel"
        );

    const dangerPanel =
        document.getElementById(
            "danger-panel"
        );

    const moreTitle =
        document.getElementById(
            "more-page-title"
        );

    const moreDescription =
        document.getElementById(
            "more-page-description"
        );

    const isAdmin =
        isAdminUser();

    if (!currentUser) {
        accountPanel?.classList.remove(
            "hidden"
        );

        backupPanel?.classList.add(
            "hidden"
        );

        dangerPanel?.classList.add(
            "hidden"
        );

        if (moreTitle) {
            moreTitle.textContent =
                "Mon espace";
        }

        if (moreDescription) {
            moreDescription.textContent =
                "Connecte-toi pour synchroniser tes données, puis gère ton coaching et tes événements.";
        }

        return;
    }

    if (isAdmin) {
        accountPanel?.classList.remove(
            "hidden"
        );

        backupPanel?.classList.remove(
            "hidden"
        );

        dangerPanel?.classList.remove(
            "hidden"
        );

        if (moreTitle) {
            moreTitle.textContent =
                "Administration & coaching";
        }

        if (moreDescription) {
            moreDescription.textContent =
                "Gère ton coaching, tes événements, la synchronisation, les sauvegardes et les outils d'administration.";
        }

        return;
    }

    accountPanel?.classList.add(
        "hidden"
    );

    backupPanel?.classList.add(
        "hidden"
    );

    dangerPanel?.classList.add(
        "hidden"
    );

    if (moreTitle) {
        moreTitle.textContent =
            "Mon coaching";
    }

    if (moreDescription) {
        moreDescription.textContent =
            "Retrouve ton profil de coaching et tes événements.";
    }
}

function requireAdminAction(
    actionLabel = "cette action"
) {
    if (isAdminUser()) {
        return true;
    }

    window.alert(
        `Accès refusé : ${actionLabel} est réservé à l'administrateur.`
    );

    return false;
}

function renderAccountState() {
    const configWarning =
        document.getElementById(
            "cloud-config-warning"
        );

    const loggedOut =
        document.getElementById(
            "account-logged-out"
        );

    const loggedIn =
        document.getElementById(
            "account-logged-in"
        );

    const chip =
        document.getElementById(
            "account-cloud-chip"
        );

    if (!configWarning) {
        return;
    }

    const configured =
        isSupabaseConfigured();

    configWarning.classList.toggle(
        "hidden",
        configured
    );

    if (!configured) {
        loggedOut.classList.remove("hidden");
        loggedIn.classList.add("hidden");
        chip.textContent = "À CONFIGURER";

        renderTopAccountButton();
        renderRoleVisibility();
        return;
    }

    if (currentUser) {
        loggedOut.classList.add("hidden");
        loggedIn.classList.remove("hidden");

        document.getElementById(
            "account-email"
        ).textContent =
            currentUser.email || "Compte Supabase";

        chip.textContent = "CLOUD";
    } else {
        loggedOut.classList.remove("hidden");
        loggedIn.classList.add("hidden");
        chip.textContent = "LOCAL";
    }

    renderTopAccountButton();
    renderRoleVisibility();
}

function renderTopAccountButton() {
    const button =
        document.getElementById(
            "account-shortcut"
        );

    const dot =
        document.getElementById(
            "top-sync-dot"
        );

    const label =
        document.getElementById(
            "top-sync-label"
        );

    if (
        !button ||
        !dot ||
        !label
    ) {
        return;
    }

    button.classList.remove(
        "logged-out",
        "config-needed",
        "offline"
    );

    if (!isSupabaseConfigured()) {
        button.classList.add(
            "config-needed"
        );

        dot.className =
            "cloud-dot local";

        label.textContent =
            "Configurer";

        return;
    }

    if (!currentUser) {
        button.classList.add(
            "logged-out"
        );

        dot.className =
            "cloud-dot synced";

        label.textContent =
            "Se connecter";

        return;
    }

    if (!navigator.onLine) {
        button.classList.add(
            "offline"
        );

        dot.className =
            "cloud-dot local";

        label.textContent =
            "Hors ligne";

        return;
    }
}

function setCloudStatus(
    state,
    label,
    detail = ""
) {
    const dot =
        document.getElementById(
            "top-sync-dot"
        );

    const text =
        document.getElementById(
            "top-sync-label"
        );

    const detailElement =
        document.getElementById(
            "account-sync-detail"
        );

    if (!currentUser) {
        renderTopAccountButton();
        return;
    }

    if (dot) {
        dot.className =
            `cloud-dot ${state}`;
    }

    if (text) {
        text.textContent = label;
    }

    if (
        detailElement &&
        currentUser
    ) {
        detailElement.textContent =
            detail ||
            (
                state === "synced"
                    ? "Toutes les données sont synchronisées"
                    : state === "syncing"
                        ? "Synchronisation en cours…"
                        : state === "error"
                            ? "Erreur de synchronisation"
                            : "Synchronisation cloud active"
            );
    }
}

function showAccountStatus(
    message,
    isError = false
) {
    const element =
        document.getElementById(
            "account-status-message"
        );

    if (!element) {
        return;
    }

    element.textContent = message;
    element.classList.remove("hidden");

    element.style.background =
        isError
            ? "rgba(211, 82, 82, 0.09)"
            : "rgba(32, 163, 122, 0.09)";

    element.style.color =
        isError
            ? "var(--danger)"
            : "var(--primary-strong)";
}

function getDirtyIds(key) {
    return loadArray(key)
        .map(String);
}

function setStoredArray(
    key,
    values
) {
    localStorage.setItem(
        key,
        JSON.stringify(
            Array.from(
                new Set(
                    values.map(String)
                )
            )
        )
    );
}

function addStoredId(
    key,
    id
) {
    const ids = getDirtyIds(key);

    if (!ids.includes(String(id))) {
        ids.push(String(id));
    }

    setStoredArray(
        key,
        ids
    );
}

function removeStoredId(
    key,
    id
) {
    setStoredArray(
        key,
        getDirtyIds(key).filter(
            (item) => item !== String(id)
        )
    );
}

function markMatchDirty(id) {
    addStoredId(
        STORAGE_KEYS.dirtyMatches,
        id
    );

    requestCloudSync();
}

function markTournamentDirty(id) {
    addStoredId(
        STORAGE_KEYS.dirtyTournaments,
        id
    );

    requestCloudSync();
}

function markProfileDirty() {
    localStorage.setItem(
        STORAGE_KEYS.dirtyProfile,
        "1"
    );

    requestCloudSync();
}

function markMatchDeleted(id) {
    addStoredId(
        STORAGE_KEYS.deletedMatches,
        id
    );

    removeStoredId(
        STORAGE_KEYS.dirtyMatches,
        id
    );

    requestCloudSync();
}

function markTournamentDeleted(id) {
    addStoredId(
        STORAGE_KEYS.deletedTournaments,
        id
    );

    removeStoredId(
        STORAGE_KEYS.dirtyTournaments,
        id
    );

    requestCloudSync();
}

function markAllLocalDataDirty() {
    setStoredArray(
        STORAGE_KEYS.dirtyMatches,
        matches.map((match) => match.id)
    );

    setStoredArray(
        STORAGE_KEYS.dirtyTournaments,
        tournaments.map(
            (tournament) => tournament.id
        )
    );

    localStorage.setItem(
        STORAGE_KEYS.dirtyProfile,
        "1"
    );

    requestCloudSync();
}

function clearCloudMarkers() {
    setStoredArray(
        STORAGE_KEYS.dirtyMatches,
        []
    );

    setStoredArray(
        STORAGE_KEYS.dirtyTournaments,
        []
    );

    setStoredArray(
        STORAGE_KEYS.deletedMatches,
        []
    );

    setStoredArray(
        STORAGE_KEYS.deletedTournaments,
        []
    );

    localStorage.removeItem(
        STORAGE_KEYS.dirtyProfile
    );
}

function requestCloudSync(
    delay = 900
) {
    if (
        !currentUser ||
        !supabaseClient ||
        !navigator.onLine
    ) {
        return;
    }

    window.clearTimeout(
        cloudSyncTimer
    );

    cloudSyncTimer =
        window.setTimeout(() => {
            syncWithCloud("automatic");
        }, delay);
}

async function fetchCloudData() {
    const [
        matchesResult,
        tournamentsResult,
        profileResult
    ] = await Promise.all([
        supabaseClient
            .from("ygo_matches")
            .select(
                "id,data,created_at,updated_at"
            )
            .eq(
                "user_id",
                currentUser.id
            ),

        supabaseClient
            .from("ygo_tournaments")
            .select(
                "id,data,created_at,updated_at"
            )
            .eq(
                "user_id",
                currentUser.id
            ),

        supabaseClient
            .from("ygo_profiles")
            .select(
                "data,updated_at"
            )
            .eq(
                "user_id",
                currentUser.id
            )
            .maybeSingle()
    ]);

    const firstError =
        matchesResult.error ||
        tournamentsResult.error ||
        profileResult.error;

    if (firstError) {
        throw firstError;
    }

    return {
        matches:
            (matchesResult.data || [])
                .map((row) => {
                    return normalizeMatch({
                        ...(row.data || {}),
                        id:
                            row.data?.id ||
                            row.id,
                        createdAt:
                            row.data?.createdAt ||
                            row.created_at,
                        updatedAt:
                            row.data?.updatedAt ||
                            row.updated_at
                    });
                }),

        tournaments:
            (tournamentsResult.data || [])
                .map((row) => {
                    return normalizeTournament({
                        ...(row.data || {}),
                        id:
                            row.data?.id ||
                            row.id,
                        createdAt:
                            row.data?.createdAt ||
                            row.created_at
                    });
                }),

        profile:
            profileResult.data?.data &&
            typeof profileResult.data.data === "object"
                ? profileResult.data.data
                : {}
    };
}

async function flushCloudDeletions() {
    const deletedMatches =
        getDirtyIds(
            STORAGE_KEYS.deletedMatches
        );

    const deletedTournaments =
        getDirtyIds(
            STORAGE_KEYS.deletedTournaments
        );

    if (deletedMatches.length > 0) {
        const {
            error
        } = await supabaseClient
            .from("ygo_matches")
            .delete()
            .eq(
                "user_id",
                currentUser.id
            )
            .in(
                "id",
                deletedMatches
            );

        if (error) {
            throw error;
        }

        setStoredArray(
            STORAGE_KEYS.deletedMatches,
            []
        );
    }

    if (deletedTournaments.length > 0) {
        const {
            error
        } = await supabaseClient
            .from("ygo_tournaments")
            .delete()
            .eq(
                "user_id",
                currentUser.id
            )
            .in(
                "id",
                deletedTournaments
            );

        if (error) {
            throw error;
        }

        setStoredArray(
            STORAGE_KEYS.deletedTournaments,
            []
        );
    }
}

async function uploadMatches(items) {
    if (items.length === 0) {
        return;
    }

    const rows = items.map((match) => ({
        user_id: currentUser.id,
        id: String(match.id),
        data: match,
        created_at:
            match.createdAt ||
            new Date().toISOString(),
        updated_at:
            match.updatedAt ||
            match.createdAt ||
            new Date().toISOString()
    }));

    const {
        error
    } = await supabaseClient
        .from("ygo_matches")
        .upsert(
            rows,
            {
                onConflict:
                    "user_id,id"
            }
        );

    if (error) {
        throw error;
    }
}

async function uploadTournaments(items) {
    if (items.length === 0) {
        return;
    }

    const rows = items.map(
        (tournament) => ({
            user_id: currentUser.id,
            id: String(tournament.id),
            data: tournament,
            created_at:
                tournament.createdAt ||
                new Date().toISOString(),
            updated_at:
                tournament.updatedAt ||
                tournament.createdAt ||
                new Date().toISOString()
        })
    );

    const {
        error
    } = await supabaseClient
        .from("ygo_tournaments")
        .upsert(
            rows,
            {
                onConflict:
                    "user_id,id"
            }
        );

    if (error) {
        throw error;
    }
}

async function uploadProfile() {
    const profileToUpload = {
        ...profile,
        updatedAt:
            profile.updatedAt ||
            new Date().toISOString()
    };

    profile = profileToUpload;

    const {
        error
    } = await supabaseClient
        .from("ygo_profiles")
        .upsert(
            {
                user_id:
                    currentUser.id,
                data:
                    profileToUpload,
                updated_at:
                    profileToUpload.updatedAt
            },
            {
                onConflict:
                    "user_id"
            }
        );

    if (error) {
        throw error;
    }
}

function mergeProfile(
    localProfile,
    cloudProfile
) {
    const localTime = new Date(
        localProfile?.updatedAt ||
        0
    ).getTime();

    const cloudTime = new Date(
        cloudProfile?.updatedAt ||
        0
    ).getTime();

    if (
        Object.keys(localProfile || {}).length === 0
    ) {
        return {
            ...(cloudProfile || {})
        };
    }

    if (
        Object.keys(cloudProfile || {}).length === 0
    ) {
        return {
            ...(localProfile || {})
        };
    }

    return localTime >= cloudTime
        ? {
            ...cloudProfile,
            ...localProfile
        }
        : {
            ...localProfile,
            ...cloudProfile
        };
}

function overlayDirtyItems(
    cloudItems,
    localItems,
    dirtyIds
) {
    const merged = new Map(
        cloudItems.map(
            (item) => [
                String(item.id),
                item
            ]
        )
    );

    dirtyIds.forEach((id) => {
        const localItem =
            localItems.find(
                (item) =>
                    String(item.id) ===
                    String(id)
            );

        if (localItem) {
            merged.set(
                String(id),
                localItem
            );
        }
    });

    return Array.from(
        merged.values()
    );
}

async function syncWithCloud(
    reason = "manual"
) {
    if (
        !currentUser ||
        !supabaseClient
    ) {
        return;
    }

    if (cloudSyncInProgress) {
        cloudSyncQueued = true;
        return;
    }

    cloudSyncInProgress = true;
    cloudSyncQueued = false;

    setCloudStatus(
        "syncing",
        "Cloud…",
        "Synchronisation en cours…"
    );

    try {
        const linkedUser =
            localStorage.getItem(
                STORAGE_KEYS.linkedUser
            );

        if (
            linkedUser &&
            linkedUser !== currentUser.id
        ) {
            clearCloudMarkers();
        }

        const dirtyMatchIds =
            getDirtyIds(
                STORAGE_KEYS.dirtyMatches
            );

        const dirtyTournamentIds =
            getDirtyIds(
                STORAGE_KEYS.dirtyTournaments
            );

        const profileDirty =
            localStorage.getItem(
                STORAGE_KEYS.dirtyProfile
            ) === "1";

        await flushCloudDeletions();

        const cloud =
            await fetchCloudData();

        if (!linkedUser) {
            // Première connexion de ce navigateur :
            // fusion des anciennes données V5 locales avec le compte cloud.
            matches = mergeById(
                cloud.matches,
                matches
            );

            tournaments = mergeById(
                cloud.tournaments,
                tournaments
            );

            profile = normalizeProfile(
                mergeProfile(
                    profile,
                    cloud.profile
                )
            );

            saveAll();

            await uploadMatches(matches);
            await uploadTournaments(
                tournaments
            );

            if (
                Object.keys(profile).length > 0
            ) {
                await uploadProfile();
            }

            clearCloudMarkers();

            localStorage.setItem(
                STORAGE_KEYS.linkedUser,
                currentUser.id
            );
        } else if (
            linkedUser !== currentUser.id
        ) {
            // Changement de compte :
            // ne transfère pas les données de l'ancien utilisateur.
            matches = cloud.matches;
            tournaments =
                cloud.tournaments;
            profile = normalizeProfile(
                cloud.profile
            );

            clearCloudMarkers();

            localStorage.setItem(
                STORAGE_KEYS.linkedUser,
                currentUser.id
            );

            saveAll();
        } else {
            const localDirtyMatches =
                matches.filter(
                    (match) =>
                        dirtyMatchIds.includes(
                            String(match.id)
                        )
                );

            const localDirtyTournaments =
                tournaments.filter(
                    (tournament) =>
                        dirtyTournamentIds.includes(
                            String(
                                tournament.id
                            )
                        )
                );

            matches =
                overlayDirtyItems(
                    cloud.matches,
                    localDirtyMatches,
                    dirtyMatchIds
                );

            tournaments =
                overlayDirtyItems(
                    cloud.tournaments,
                    localDirtyTournaments,
                    dirtyTournamentIds
                );

            if (!profileDirty) {
                profile = normalizeProfile(
                cloud.profile
            );
            }

            saveAll();

            await uploadMatches(
                localDirtyMatches
            );

            await uploadTournaments(
                localDirtyTournaments
            );

            if (profileDirty) {
                await uploadProfile();
            }

            setStoredArray(
                STORAGE_KEYS.dirtyMatches,
                []
            );

            setStoredArray(
                STORAGE_KEYS.dirtyTournaments,
                []
            );

            localStorage.removeItem(
                STORAGE_KEYS.dirtyProfile
            );
        }

        renderEverything();

        lastSuccessfulCloudSync =
            Date.now();

        localStorage.setItem(
            STORAGE_KEYS.lastCloudSyncAt,
            String(
                lastSuccessfulCloudSync
            )
        );

        setCloudStatus(
            "synced",
            "Cloud ✓",
            `Synchronisé • ${new Date().toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit"
            })}`
        );

        if (reason === "manual") {
            showAccountStatus(
                "Synchronisation terminée."
            );
        }
    } catch (error) {
        console.error(
            "Erreur cloud :",
            error
        );

        setCloudStatus(
            "error",
            "Cloud !",
            "La copie locale reste disponible."
        );

        showAccountStatus(
            `Erreur de synchronisation : ${error.message || error}`,
            true
        );
    } finally {
        cloudSyncInProgress = false;

        if (cloudSyncQueued) {
            cloudSyncQueued = false;
            requestCloudSync(250);
        }
    }
}

async function signIn() {
    if (!initializeSupabaseClient()) {
        showAccountStatus(
            "Configure d'abord config.js.",
            true
        );
        return;
    }

    const email =
        document
            .getElementById("auth-email")
            .value
            .trim();

    const password =
        document
            .getElementById("auth-password")
            .value;

    if (!email || password.length < 6) {
        showAccountStatus(
            "Entre un email valide et un mot de passe d'au moins 6 caractères.",
            true
        );
        return;
    }

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        showAccountStatus(
            error.message,
            true
        );
    }
}

async function signUp() {
    if (!initializeSupabaseClient()) {
        showAccountStatus(
            "Configure d'abord config.js.",
            true
        );
        return;
    }

    const email =
        document
            .getElementById("auth-email")
            .value
            .trim();

    const password =
        document
            .getElementById("auth-password")
            .value;

    if (!email || password.length < 6) {
        showAccountStatus(
            "Entre un email valide et un mot de passe d'au moins 6 caractères.",
            true
        );
        return;
    }

    const redirectUrl =
        `${window.location.origin}${window.location.pathname}`;

    const {
        data,
        error
    } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo:
                redirectUrl
        }
    });

    if (error) {
        showAccountStatus(
            error.message,
            true
        );
        return;
    }

    if (data.session) {
        showAccountStatus(
            "Compte créé et connecté."
        );
    } else {
        showAccountStatus(
            "Compte créé. Vérifie ton email pour confirmer ton adresse, puis reconnecte-toi."
        );
    }
}

async function signOut() {
    if (!supabaseClient) {
        return;
    }

    const {
        error
    } = await supabaseClient.auth.signOut();

    if (error) {
        showAccountStatus(
            error.message,
            true
        );
        return;
    }

    currentUser = null;
    renderAccountState();

    renderTopAccountButton();

    showAccountStatus(
        "Déconnecté. La copie locale reste disponible sur cet appareil."
    );
}

async function sendPasswordReset() {
    if (!initializeSupabaseClient()) {
        showAccountStatus(
            "Configure d'abord config.js.",
            true
        );
        return;
    }

    const email =
        document
            .getElementById("auth-email")
            .value
            .trim();

    if (!email) {
        showAccountStatus(
            "Entre ton email avant de demander un nouveau mot de passe.",
            true
        );
        return;
    }

    const redirectTo =
        `${window.location.origin}${window.location.pathname}`;

    const {
        error
    } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
            redirectTo
        }
    );

    if (error) {
        showAccountStatus(
            error.message,
            true
        );
        return;
    }

    showAccountStatus(
        "Email de réinitialisation envoyé."
    );
}

async function deleteAllCloudData() {
    if (
        !currentUser ||
        !supabaseClient
    ) {
        return;
    }

    const [
        matchesDelete,
        tournamentsDelete,
        profileDelete
    ] = await Promise.all([
        supabaseClient
            .from("ygo_matches")
            .delete()
            .eq(
                "user_id",
                currentUser.id
            ),

        supabaseClient
            .from("ygo_tournaments")
            .delete()
            .eq(
                "user_id",
                currentUser.id
            ),

        supabaseClient
            .from("ygo_profiles")
            .delete()
            .eq(
                "user_id",
                currentUser.id
            )
    ]);

    const error =
        matchesDelete.error ||
        tournamentsDelete.error ||
        profileDelete.error;

    if (error) {
        throw error;
    }
}

function renderEverything() {
    renderHome();
    renderMatches();
    renderStats();
    renderTournaments();
    renderProfile();
    renderAccountState();
}

function renderHome() {
    const wins = matches.filter(
        (match) => match.result === "win"
    ).length;

    const losses = matches.length - wins;
    const allGames = getAllGames();
    const g1Games = allGames.filter(
        (game) => game.number === 1
    );
    const postSideGames = allGames.filter(
        (game) => game.number >= 2
    );
    const secondGames = allGames.filter(
        (game) => game.position === "second"
    );

    document.getElementById("home-winrate").textContent =
        formatPercent(
            winrateForMatches(matches) ?? 0
        );

    document.getElementById("home-record").textContent =
        `${wins} victoire${wins > 1 ? "s" : ""} • ${losses} défaite${losses > 1 ? "s" : ""}`;

    document.getElementById("home-total-matches").textContent =
        matches.length;

    document.getElementById("home-g1-winrate").textContent =
        formatPercent(winrateForGames(g1Games));

    document.getElementById("home-post-side-winrate").textContent =
        formatPercent(winrateForGames(postSideGames));

    document.getElementById("home-second-winrate").textContent =
        formatPercent(winrateForGames(secondGames));

    document.getElementById("coach-message").textContent =
        buildCoachMessage();

    const container =
        document.getElementById("recent-matches");

    if (matches.length === 0) {
        container.innerHTML = emptyState(
            "Aucun match enregistré."
        );

        return;
    }

    container.innerHTML = matches
        .slice()
        .sort(
            (a, b) =>
                new Date(b.createdAt) -
                new Date(a.createdAt)
        )
        .slice(0, 3)
        .map(matchCardTemplate)
        .join("");
}

function buildCoachMessage() {
    if (matches.length < 3) {
        return "Ajoute au moins 3 matchs. Dès que tu détailles quelques games, je peux comparer G1, après side, going first et going second.";
    }

    const allGames = getAllGames();

    const openingHandInsight =
        buildOpeningHandInsight(
            allGames
        );

    if (openingHandInsight) {
        return openingHandInsight;
    }

    if (allGames.length >= 6) {
        const firstGames = allGames.filter(
            (game) => game.position === "first"
        );

        const secondGames = allGames.filter(
            (game) => game.position === "second"
        );

        const firstWinrate = winrateForGames(firstGames);
        const secondWinrate = winrateForGames(secondGames);

        if (
            firstGames.length >= 3 &&
            secondGames.length >= 3 &&
            firstWinrate !== null &&
            secondWinrate !== null &&
            firstWinrate - secondWinrate >= 20
        ) {
            return `Priorité actuelle : le going second. Tu es à ${firstWinrate} % en premier contre ${secondWinrate} % en second sur les games détaillées.`;
        }

        const g1Games = allGames.filter(
            (game) => game.number === 1
        );

        const postSideGames = allGames.filter(
            (game) => game.number >= 2
        );

        const g1Winrate = winrateForGames(g1Games);
        const postSideWinrate = winrateForGames(postSideGames);

        if (
            g1Games.length >= 3 &&
            postSideGames.length >= 4 &&
            g1Winrate !== null &&
            postSideWinrate !== null &&
            g1Winrate - postSideWinrate >= 18
        ) {
            return `Ton point faible semble être l'après-side : ${g1Winrate} % en G1 contre ${postSideWinrate} % en G2/G3. Revois tes plans de side et les cartes que tu rentres le plus souvent.`;
        }

        const reasonStats = getReasonStats();
        const topReason = reasonStats[0];

        if (
            topReason &&
            topReason.count >= 3
        ) {
            return `Le motif qui revient le plus est "${reasonLabel(topReason.reason)}" (${topReason.count} fois). Fais-en ton prochain axe d'entraînement.`;
        }
    }

    const weakMatchup = getMatchupStats().find(
        (item) =>
            item.matches >= 3 &&
            item.matchWinrate !== null &&
            item.matchWinrate < 45
    );

    if (weakMatchup) {
        return `Matchup à travailler : ${weakMatchup.name}. Tu es à ${weakMatchup.matchWinrate} % sur ${weakMatchup.matches} matchs. Prépare un plan G1 et un plan après side spécifiques.`;
    }

    const globalWinrate = winrateForMatches(matches);

    if (
        globalWinrate !== null &&
        globalWinrate >= 70
    ) {
        const goalText = profile.goal
            ? ` Ton objectif "${profile.goal}" est cohérent avec cette dynamique.`
            : "";

        return `Très bonne dynamique : ${globalWinrate} % de victoire.${goalText} Continue surtout à détailler tes défaites pour éviter les angles morts.`;
    }

    return "Tes résultats sont assez équilibrés. Le meilleur gain maintenant est de détailler G1/G2/G3 et ton side : c'est ce qui rendra les conseils beaucoup plus précis.";
}

function matchCardTemplate(match) {
    const resultClass =
        match.result === "win"
            ? "win"
            : "loss";

    const resultLabel =
        match.result === "win"
            ? "Victoire"
            : "Défaite";

    const tournament = tournaments.find(
        (item) => item.id === match.tournamentId
    );

    const gameRows = match.games
        .filter(
            (game) =>
                game.result ||
                game.note ||
                game.sideIn.length ||
                game.sideOut.length ||
                game.openingHand.length
        )
        .map((game) => {
            const gameClass =
                game.result === "loss"
                    ? "loss"
                    : "";

            const sideText =
                game.number >= 2 &&
                (
                    game.sideIn.length ||
                    game.sideOut.length
                )
                    ? `
                        <div class="side-line">
                            IN: ${escapeHtml(game.sideIn.join(", ") || "-")}
                            • OUT: ${escapeHtml(game.sideOut.join(", ") || "-")}
                        </div>
                    `
                    : "";

            const handText =
                game.openingHand.length
                    ? `
                        <div class="side-line opening-hand-summary">
                            Main : ${escapeHtml(game.openingHand.join(" • "))}
                        </div>
                    `
                    : "";

            return `
                <div class="game-summary-row ${gameClass}">
                    <span>G${game.number}</span>

                    <strong>
                        ${gameResultLabel(game.result)}
                    </strong>

                    <div>
                        ${escapeHtml(positionLabel(game.position))}
                        ${sideText}
                        ${handText}
                    </div>
                </div>
            `;
        })
        .join("");

    return `
        <article class="match-card">
            <div class="match-top">
                <div>
                    <h3 class="match-title">
                        ${escapeHtml(match.opponentDeck)}
                    </h3>

                    <p class="match-meta">
                        ${formatDate(match.createdAt)}
                        • G1 ${escapeHtml(positionLabel(match.position))}
                        • Dice ${match.dice === "win" ? "gagné" : "perdu"}
                    </p>
                </div>

                <span class="result-badge ${resultClass}">
                    ${resultLabel} ${escapeHtml(match.score)}
                </span>
            </div>

            ${
                tournament
                    ? `
                        <p class="match-meta">
                            🏆 ${escapeHtml(tournament.name)}
                        </p>
                    `
                    : ""
            }

            ${
                gameRows
                    ? `
                        <div class="game-summary">
                            ${gameRows}
                        </div>
                    `
                    : `
                        <p class="match-meta">
                            Détail G1/G2/G3 non renseigné.
                        </p>
                    `
            }

            ${
                match.note
                    ? `
                        <p class="match-note">
                            ${escapeHtml(match.note)}
                        </p>
                    `
                    : ""
            }

            <div class="match-actions">
                <button
                    class="link-button"
                    type="button"
                    data-edit-match="${match.id}"
                >
                    Modifier
                </button>

                <button
                    class="danger-button"
                    type="button"
                    data-delete-match="${match.id}"
                >
                    Supprimer
                </button>
            </div>
        </article>
    `;
}

function renderMatches() {
    const filter =
        document.getElementById("match-filter").value;

    const search =
        document
            .getElementById("match-search")
            .value
            .trim()
            .toLowerCase();

    let filteredMatches = matches.slice();

    if (
        filter === "win" ||
        filter === "loss"
    ) {
        filteredMatches = filteredMatches.filter(
            (match) => match.result === filter
        );
    }

    if (
        filter === "first" ||
        filter === "second"
    ) {
        filteredMatches = filteredMatches.filter(
            (match) => match.position === filter
        );
    }

    if (filter === "detailed") {
        filteredMatches = filteredMatches.filter(
            (match) => match.games.length > 0
        );
    }

    if (search) {
        filteredMatches = filteredMatches.filter(
            (match) =>
                match.opponentDeck
                    .toLowerCase()
                    .includes(search) ||
                match.myDeck
                    .toLowerCase()
                    .includes(search)
        );
    }

    filteredMatches.sort(
        (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
    );

    const container =
        document.getElementById("matches-list");

    if (filteredMatches.length === 0) {
        container.innerHTML = emptyState(
            "Aucun match dans ce filtre."
        );

        return;
    }

    container.innerHTML = filteredMatches
        .map(matchCardTemplate)
        .join("");
}

function renderStats() {
    const allGames = getAllGames();

    const g1Games = allGames.filter(
        (game) => game.number === 1
    );

    const postSideGames = allGames.filter(
        (game) => game.number >= 2
    );

    const firstGames = allGames.filter(
        (game) => game.position === "first"
    );

    const secondGames = allGames.filter(
        (game) => game.position === "second"
    );

    document.getElementById("stat-global").textContent =
        formatPercent(
            winrateForMatches(matches) ?? 0
        );

    document.getElementById("stat-games").textContent =
        formatPercent(winrateForGames(allGames));

    document.getElementById("stat-g1").textContent =
        formatPercent(winrateForGames(g1Games));

    document.getElementById("stat-post-side").textContent =
        formatPercent(winrateForGames(postSideGames));

    document.getElementById("stat-first").textContent =
        formatPercent(winrateForGames(firstGames));

    document.getElementById("stat-second").textContent =
        formatPercent(winrateForGames(secondGames));

    renderMatchupStats();
    renderSideStats();
    renderReasonStats();
}

function getMatchupStats() {
    const grouped = {};

    matches.forEach((match) => {
        const key = match.opponentDeck
            .trim()
            .toLowerCase();

        if (!grouped[key]) {
            grouped[key] = {
                name: match.opponentDeck.trim(),
                matches: [],
                games: []
            };
        }

        grouped[key].matches.push(match);
        grouped[key].games.push(...match.games);
    });

    return Object.values(grouped)
        .map((item) => ({
            name: item.name,
            matches: item.matches.length,
            matchWinrate:
                winrateForMatches(item.matches),
            gameWinrate:
                winrateForGames(item.games)
        }))
        .sort(
            (a, b) => b.matches - a.matches
        );
}

function renderMatchupStats() {
    const container =
        document.getElementById("matchup-stats");

    const stats = getMatchupStats();

    if (stats.length === 0) {
        container.innerHTML = emptyState(
            "Pas encore de matchup enregistré."
        );

        return;
    }

    container.innerHTML = stats
        .map((item) => `
            <div class="metric-row">
                <div>
                    <strong>
                        ${escapeHtml(item.name)}
                    </strong>

                    <div class="metric-sub">
                        ${item.matches} match${item.matches > 1 ? "s" : ""}
                        • Games détaillées : ${formatPercent(item.gameWinrate)}
                    </div>
                </div>

                <strong>
                    ${formatPercent(item.matchWinrate)}
                </strong>
            </div>
        `)
        .join("");
}

function getSideStats() {
    const grouped = {};

    getAllGames()
        .filter((game) => game.number >= 2)
        .forEach((game) => {
            game.sideIn.forEach((card) => {
                const key = card.toLowerCase();

                if (!grouped[key]) {
                    grouped[key] = {
                        name: card,
                        uses: 0,
                        wins: 0,
                        games: 0
                    };
                }

                grouped[key].uses += 1;

                if (
                    game.result === "win" ||
                    game.result === "loss"
                ) {
                    grouped[key].games += 1;

                    if (game.result === "win") {
                        grouped[key].wins += 1;
                    }
                }
            });
        });

    return Object.values(grouped)
        .map((item) => ({
            ...item,
            winrate: percentage(
                item.wins,
                item.games
            )
        }))
        .sort((a, b) => b.uses - a.uses);
}

function renderSideStats() {
    const container =
        document.getElementById("side-stats");

    const stats = getSideStats();

    if (stats.length === 0) {
        container.innerHTML = emptyState(
            "Renseigne les cartes sidées IN en G2/G3 pour commencer cette analyse."
        );

        return;
    }

    container.innerHTML = stats
        .slice(0, 15)
        .map((item) => `
            <div class="metric-row">
                <div>
                    <strong>
                        ${escapeHtml(item.name)}
                    </strong>

                    <div class="metric-sub">
                        Sidée ${item.uses} fois
                    </div>
                </div>

                <strong>
                    ${formatPercent(item.winrate)}
                </strong>
            </div>
        `)
        .join("");
}

function getReasonStats() {
    const grouped = {};

    getAllGames().forEach((game) => {
        if (!game.reason) {
            return;
        }

        if (!grouped[game.reason]) {
            grouped[game.reason] = 0;
        }

        grouped[game.reason] += 1;
    });

    matches.forEach((match) => {
        if (
            match.games.length === 0 &&
            match.mistakeType
        ) {
            if (!grouped[match.mistakeType]) {
                grouped[match.mistakeType] = 0;
            }

            grouped[match.mistakeType] += 1;
        }
    });

    return Object.entries(grouped)
        .map(([reason, count]) => ({
            reason,
            count
        }))
        .sort((a, b) => b.count - a.count);
}

function renderReasonStats() {
    const container =
        document.getElementById("reason-stats");

    const stats = getReasonStats();

    if (stats.length === 0) {
        container.innerHTML = emptyState(
            "Renseigne les causes / points clés de tes games pour obtenir cette analyse."
        );

        return;
    }

    container.innerHTML = stats
        .map((item) => `
            <div class="metric-row">
                <span>
                    ${escapeHtml(reasonLabel(item.reason))}
                </span>

                <strong>
                    ${item.count}
                </strong>
            </div>
        `)
        .join("");
}

function getTournamentMatches(
    tournamentId
) {
    return matches
        .filter(
            (match) =>
                match.tournamentId ===
                tournamentId
        )
        .slice()
        .sort(
            (a, b) =>
                new Date(a.createdAt) -
                new Date(b.createdAt)
        );
}

function getEventDecks(
    tournamentMatches
) {
    const grouped =
        new Map();

    tournamentMatches.forEach(
        (match) => {
            const name =
                match.myDeck ||
                "Deck non renseigné";

            grouped.set(
                name,
                (grouped.get(name) || 0) +
                    1
            );
        }
    );

    return Array.from(
        grouped.entries()
    )
        .sort(
            (a, b) =>
                b[1] - a[1]
        )
        .map(
            ([name, count]) => ({
                name,
                count
            })
        );
}

function getEventOpponentStats(
    tournamentMatches
) {
    const grouped =
        new Map();

    tournamentMatches.forEach(
        (match) => {
            const name =
                match.opponentDeck ||
                "Deck inconnu";

            const key =
                normalizeDeckKey(name);

            if (!grouped.has(key)) {
                grouped.set(
                    key,
                    {
                        name,
                        matches: 0,
                        wins: 0,
                        losses: 0
                    }
                );
            }

            const item =
                grouped.get(key);

            item.matches += 1;

            if (
                match.result === "win"
            ) {
                item.wins += 1;
            } else {
                item.losses += 1;
            }
        }
    );

    return Array.from(
        grouped.values()
    )
        .sort(
            (a, b) =>
                b.matches - a.matches ||
                a.name.localeCompare(
                    b.name,
                    "fr",
                    {
                        sensitivity:
                            "base"
                    }
                )
        );
}

function getEventTopIssue(
    tournamentMatches
) {
    const reasons =
        new Map();

    tournamentMatches
        .flatMap(
            (match) =>
                match.games || []
        )
        .filter(
            (game) =>
                game.result === "loss" &&
                game.reason
        )
        .forEach(
            (game) => {
                reasons.set(
                    game.reason,
                    (reasons.get(
                        game.reason
                    ) || 0) + 1
                );
            }
        );

    const top =
        Array.from(
            reasons.entries()
        )
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )[0];

    if (!top) {
        return null;
    }

    return {
        reason: top[0],
        count: top[1]
    };
}

function renderTournamentSummary(
    tournamentId
) {
    const tournament =
        tournaments.find(
            (item) =>
                item.id === tournamentId
        );

    const content =
        document.getElementById(
            "tournament-summary-content"
        );

    if (
        !tournament ||
        !content
    ) {
        return;
    }

    const tournamentMatches =
        getTournamentMatches(
            tournamentId
        );

    const matchWins =
        tournamentMatches.filter(
            (match) =>
                match.result === "win"
        ).length;

    const matchLosses =
        tournamentMatches.length -
        matchWins;

    const games =
        tournamentMatches.flatMap(
            (match) =>
                match.games || []
        );

    const gameWins =
        games.filter(
            (game) =>
                game.result === "win"
        ).length;

    const gameLosses =
        games.filter(
            (game) =>
                game.result === "loss"
        ).length;

    const g1Games =
        games.filter(
            (game) =>
                game.number === 1
        );

    const postSideGames =
        games.filter(
            (game) =>
                game.number >= 2
        );

    const firstGames =
        games.filter(
            (game) =>
                game.position === "first"
        );

    const secondGames =
        games.filter(
            (game) =>
                game.position === "second"
        );

    const diceWins =
        tournamentMatches.filter(
            (match) =>
                match.dice === "win"
        ).length;

    const decks =
        getEventDecks(
            tournamentMatches
        );

    const opponentStats =
        getEventOpponentStats(
            tournamentMatches
        );

    const topIssue =
        getEventTopIssue(
            tournamentMatches
        );

    document.getElementById(
        "tournament-summary-title"
    ).textContent =
        tournament.name;

    document.getElementById(
        "tournament-summary-date"
    ).textContent =
        `${formatDate(tournament.createdAt)} • ${tournamentMatches.length} ronde${tournamentMatches.length > 1 ? "s" : ""}`;

    if (
        tournamentMatches.length === 0
    ) {
        content.innerHTML = `
            <div class="event-summary-empty">
                <div class="event-summary-empty-icon">🏆</div>
                <h3>Aucune ronde enregistrée</h3>
                <p>
                    Lors de ta prochaine ronde, sélectionne
                    <strong>${escapeHtml(tournament.name)}</strong>
                    dans le champ tournoi.
                </p>
            </div>
        `;

        return;
    }

    const matchWinrate =
        winrateForMatches(
            tournamentMatches
        );

    const gameWinrate =
        winrateForGames(
            games
        );

    const bestDeck =
        decks[0];

    const recordClass =
        matchWins > matchLosses
            ? "positive"
            : matchWins < matchLosses
                ? "negative"
                : "neutral";

    content.innerHTML = `
        <section class="event-hero ${recordClass}">
            <div>
                <span class="event-hero-label">
                    Résultat final
                </span>

                <strong class="event-record">
                    ${matchWins}-${matchLosses}
                </strong>

                <span class="event-hero-sub">
                    ${formatPercent(matchWinrate)} de victoires
                </span>
            </div>

            <div class="event-winrate-ring">
                <strong>
                    ${matchWinrate ?? 0}%
                </strong>
                <small>WINRATE</small>
            </div>
        </section>

        <section class="event-stat-grid">
            <article class="event-stat-card">
                <span>Rounds</span>
                <strong>${tournamentMatches.length}</strong>
                <small>${matchWins} V • ${matchLosses} D</small>
            </article>

            <article class="event-stat-card">
                <span>Games</span>
                <strong>${gameWins}-${gameLosses}</strong>
                <small>${formatPercent(gameWinrate)}</small>
            </article>

            <article class="event-stat-card">
                <span>G1</span>
                <strong>${formatPercent(winrateForGames(g1Games))}</strong>
                <small>${g1Games.length} game${g1Games.length > 1 ? "s" : ""}</small>
            </article>

            <article class="event-stat-card">
                <span>Après side</span>
                <strong>${formatPercent(winrateForGames(postSideGames))}</strong>
                <small>${postSideGames.length} game${postSideGames.length > 1 ? "s" : ""}</small>
            </article>

            <article class="event-stat-card">
                <span>Going first</span>
                <strong>${formatPercent(winrateForGames(firstGames))}</strong>
                <small>${firstGames.length} game${firstGames.length > 1 ? "s" : ""}</small>
            </article>

            <article class="event-stat-card">
                <span>Going second</span>
                <strong>${formatPercent(winrateForGames(secondGames))}</strong>
                <small>${secondGames.length} game${secondGames.length > 1 ? "s" : ""}</small>
            </article>
        </section>

        <section class="event-insights">
            <article class="event-insight-card">
                <span class="event-insight-icon">🎴</span>
                <div>
                    <small>Deck joué</small>
                    <strong>
                        ${escapeHtml(bestDeck?.name || "Non renseigné")}
                    </strong>
                    ${
                        decks.length > 1
                            ? `
                                <p>
                                    ${decks
                                        .map(
                                            (deck) =>
                                                `${escapeHtml(deck.name)} ×${deck.count}`
                                        )
                                        .join(" • ")}
                                </p>
                            `
                            : ""
                    }
                </div>
            </article>

            <article class="event-insight-card">
                <span class="event-insight-icon">🎲</span>
                <div>
                    <small>Dés gagnés</small>
                    <strong>
                        ${diceWins}/${tournamentMatches.length}
                    </strong>
                    <p>
                        ${formatPercent(
                            percentage(
                                diceWins,
                                tournamentMatches.length
                            )
                        )}
                    </p>
                </div>
            </article>

            ${
                topIssue
                    ? `
                        <article class="event-insight-card">
                            <span class="event-insight-icon">🦉</span>
                            <div>
                                <small>Point à travailler</small>
                                <strong>
                                    ${escapeHtml(reasonLabel(topIssue.reason))}
                                </strong>
                                <p>
                                    ${topIssue.count} game${topIssue.count > 1 ? "s" : ""} perdue${topIssue.count > 1 ? "s" : ""}
                                </p>
                            </div>
                        </article>
                    `
                    : `
                        <article class="event-insight-card">
                            <span class="event-insight-icon">🦉</span>
                            <div>
                                <small>Coach</small>
                                <strong>Aucun motif dominant</strong>
                                <p>
                                    Continue à renseigner la cause des défaites.
                                </p>
                            </div>
                        </article>
                    `
            }
        </section>

        <section class="event-summary-section">
            <div class="event-summary-section-head">
                <div>
                    <p class="section-kicker">Parcours</p>
                    <h3>Ronde par ronde</h3>
                </div>

                <span class="panel-chip">
                    ${matchWins}-${matchLosses}
                </span>
            </div>

            <div class="event-round-list">
                ${tournamentMatches
                    .map(
                        (match, index) => {
                            const isWin =
                                match.result ===
                                "win";

                            const gameRecord =
                                (match.games || [])
                                    .filter(
                                        (game) =>
                                            game.result === "win" ||
                                            game.result === "loss"
                                    );

                            const gameWinsForMatch =
                                gameRecord.filter(
                                    (game) =>
                                        game.result === "win"
                                ).length;

                            const gameLossesForMatch =
                                gameRecord.filter(
                                    (game) =>
                                        game.result === "loss"
                                ).length;

                            return `
                                <article class="event-round-card">
                                    <div class="event-round-number">
                                        R${index + 1}
                                    </div>

                                    <div class="event-round-main">
                                        <div class="event-round-title-row">
                                            <strong>
                                                ${escapeHtml(match.opponentDeck)}
                                            </strong>

                                            <span class="event-round-result ${isWin ? "win" : "loss"}">
                                                ${isWin ? "VICTOIRE" : "DÉFAITE"}
                                                ${escapeHtml(match.score || `${gameWinsForMatch}-${gameLossesForMatch}`)}
                                            </span>
                                        </div>

                                        <div class="event-round-meta">
                                            <span>
                                                ${escapeHtml(match.myDeck || "Deck non renseigné")}
                                            </span>
                                            <span>
                                                G1 ${escapeHtml(positionLabel(match.position))}
                                            </span>
                                            <span>
                                                Dé ${match.dice === "win" ? "gagné" : "perdu"}
                                            </span>
                                        </div>

                                        ${
                                            match.note
                                                ? `
                                                    <p class="event-round-note">
                                                        ${escapeHtml(match.note)}
                                                    </p>
                                                `
                                                : ""
                                        }
                                    </div>
                                </article>
                            `;
                        }
                    )
                    .join("")}
            </div>
        </section>

        <section class="event-summary-section">
            <div class="event-summary-section-head">
                <div>
                    <p class="section-kicker">Matchups</p>
                    <h3>Decks affrontés</h3>
                </div>
            </div>

            <div class="event-matchup-list">
                ${opponentStats
                    .map(
                        (item) => `
                            <div class="event-matchup-row">
                                <div>
                                    <strong>
                                        ${escapeHtml(item.name)}
                                    </strong>

                                    <small>
                                        ${item.matches} rencontre${item.matches > 1 ? "s" : ""}
                                    </small>
                                </div>

                                <span>
                                    ${item.wins}-${item.losses}
                                </span>
                            </div>
                        `
                    )
                    .join("")}
            </div>
        </section>
    `;
}

function openTournamentSummary(
    tournamentId
) {
    const modal =
        document.getElementById(
            "tournament-summary-modal"
        );

    if (!modal) {
        return;
    }

    renderTournamentSummary(
        tournamentId
    );

    modal.dataset.tournamentId =
        tournamentId;

    modal.classList.remove(
        "hidden"
    );

    document.body.classList.add(
        "event-summary-open"
    );

    window.setTimeout(
        () => {
            document.getElementById(
                "close-tournament-summary"
            )?.focus();
        },
        20
    );
}

function closeTournamentSummary() {
    const modal =
        document.getElementById(
            "tournament-summary-modal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add(
        "hidden"
    );

    modal.removeAttribute(
        "data-tournament-id"
    );

    document.body.classList.remove(
        "event-summary-open"
    );
}

function renderTournaments() {
    const select =
        document.getElementById("tournament");

    const selectedValue = select.value;

    select.innerHTML = `
        <option value="">
            Aucun tournoi
        </option>

        ${tournaments
            .map((tournament) => `
                <option value="${tournament.id}">
                    ${escapeHtml(tournament.name)}
                </option>
            `)
            .join("")}
    `;

    if (
        tournaments.some(
            (item) => item.id === selectedValue
        )
    ) {
        select.value = selectedValue;
    }

    const container =
        document.getElementById("tournaments-list");

    if (tournaments.length === 0) {
        container.innerHTML = emptyState(
            "Aucun tournoi créé."
        );

        return;
    }

    container.innerHTML = tournaments
        .slice()
        .sort(
            (a, b) =>
                new Date(b.createdAt) -
                new Date(a.createdAt)
        )
        .map((tournament) => {
            const tournamentMatches =
                matches.filter(
                    (match) =>
                        match.tournamentId ===
                        tournament.id
                );

            const wins =
                tournamentMatches.filter(
                    (match) =>
                        match.result === "win"
                ).length;

            const losses =
                tournamentMatches.length - wins;

            return `
                <article class="tournament-card tournament-card-clickable">
                    <button
                        class="tournament-open-button"
                        type="button"
                        data-open-tournament="${escapeHtml(tournament.id)}"
                        aria-label="Voir le résumé de ${escapeHtml(tournament.name)}"
                    >
                        <div class="tournament-top">
                            <div>
                                <h3 class="tournament-title">
                                    ${escapeHtml(tournament.name)}
                                </h3>

                                <p class="tournament-meta">
                                    ${formatDate(tournament.createdAt)}
                                    • ${wins}-${losses}
                                    • ${tournamentMatches.length} ronde${tournamentMatches.length > 1 ? "s" : ""}
                                </p>
                            </div>

                            <div class="tournament-card-score">
                                <strong>
                                    ${formatPercent(winrateForMatches(tournamentMatches))}
                                </strong>

                                <span>
                                    Voir le résumé →
                                </span>
                            </div>
                        </div>
                    </button>

                    <div class="match-actions tournament-actions">
                        <button
                            class="danger-button"
                            type="button"
                            data-delete-tournament="${tournament.id}"
                        >
                            Supprimer
                        </button>
                    </div>
                </article>
            `;
        })
        .join("");
}

function renderProfile() {
    profile = normalizeProfile(profile);

    const activeDeck =
        getActiveMyDeck();

    const profileName =
        document.getElementById(
            "profile-name"
        );

    const profileDeck =
        document.getElementById(
            "profile-deck"
        );

    const profileGoal =
        document.getElementById(
            "profile-goal"
        );

    if (profileName) {
        profileName.value =
            profile.name || "";
    }

    if (profileDeck) {
        profileDeck.value =
            activeDeck?.name ||
            profile.deck ||
            "";
    }

    if (profileGoal) {
        profileGoal.value =
            profile.goal || "";
    }

    const pageName =
        document.getElementById(
            "profile-page-name"
        );

    const pageEmail =
        document.getElementById(
            "profile-page-email"
        );

    const pageGoal =
        document.getElementById(
            "profile-page-goal"
        );

    if (pageName) {
        pageName.textContent =
            profile.name ||
            "Joueur YGO";
    }

    if (pageEmail) {
        pageEmail.textContent =
            currentUser?.email ||
            "Mode local";
    }

    if (pageGoal) {
        pageGoal.textContent =
            profile.goal ||
            "À définir";
    }

    updateCardLanguageUi();
    renderMyDeckLibrary();
    renderMyDeckChoices();
    renderOpponentCatalogSummary();
    renderDeckBuilder();
    renderDuelDeckHelpers();
}

function renderMyDeckLibrary() {
    const list =
        document.getElementById(
            "my-decks-list"
        );

    const count =
        document.getElementById(
            "my-decks-count"
        );

    const activeLabel =
        document.getElementById(
            "active-deck-name"
        );

    if (!list) {
        return;
    }

    const decks = getMyDecks();
    const activeDeck =
        getActiveMyDeck();

    if (count) {
        count.textContent =
            `${decks.length} DECK${decks.length > 1 ? "S" : ""}`;
    }

    if (activeLabel) {
        activeLabel.textContent =
            activeDeck?.name ||
            "Aucun deck";
    }

    if (decks.length === 0) {
        list.innerHTML = `
            <div class="empty-state compact-empty-state">
                Aucun deck enregistré. Ajoute ton premier deck juste au-dessus.
            </div>
        `;

        return;
    }

    list.innerHTML = decks
        .map((deck) => {
            const isActive =
                deck.id ===
                profile.activeDeckId;

            return `
                <article class="deck-library-card ${isActive ? "active" : ""}">
                    <button
                        class="deck-library-select"
                        type="button"
                        data-select-personal-deck="${escapeHtml(deck.id)}"
                    >
                        <span class="deck-card-icon">▤</span>

                        <span>
                            <strong>${escapeHtml(deck.name)}</strong>
                            <small>
                                ${deckZoneCount(deck.mainDeck)} Main •
                                ${deckZoneCount(deck.extraDeck)} Extra •
                                ${deckZoneCount(deck.sideDeck)} Side
                            </small>
                        </span>

                        ${isActive ? '<span class="active-deck-badge">ACTIF</span>' : ''}
                    </button>

                    <button
                        class="deck-build-button"
                        type="button"
                        data-build-personal-deck="${escapeHtml(deck.id)}"
                    >
                        Construire
                    </button>

                    <button
                        class="deck-delete-button"
                        type="button"
                        data-delete-personal-deck="${escapeHtml(deck.id)}"
                        aria-label="Supprimer ${escapeHtml(deck.name)}"
                    >
                        ×
                    </button>
                </article>
            `;
        })
        .join("");
}

function renderMyDeckChoices() {
    const container =
        document.getElementById(
            "my-deck-options"
        );

    const input =
        document.getElementById(
            "my-deck"
        );

    if (!container || !input) {
        return;
    }

    const decks = getMyDecks();

    if (decks.length === 0) {
        container.innerHTML = `
            <span class="deck-chip-empty">
                Aucun deck enregistré
            </span>
        `;

        return;
    }

    const selectedKey =
        normalizeDeckKey(input.value);

    container.innerHTML = decks
        .map((deck) => {
            const selected =
                normalizeDeckKey(deck.name) ===
                selectedKey;

            return `
                <button
                    class="deck-choice-chip ${selected ? "selected" : ""}"
                    type="button"
                    data-pick-my-deck="${escapeHtml(deck.id)}"
                >
                    ${escapeHtml(deck.name)}
                </button>
            `;
        })
        .join("");
}

function renderOpponentCatalogSummary() {
    const count =
        document.getElementById(
            "opponent-catalog-count"
        );

    if (count) {
        count.textContent =
            `${opponentDeckCatalog.length} DECK${opponentDeckCatalog.length > 1 ? "S" : ""}`;
    }
}

function showCatalogStatus(
    message,
    isError = false
) {
    const element =
        document.getElementById(
            "catalog-status"
        );

    const inlineStatus =
        document.getElementById(
            "opponent-catalog-inline-status"
        );

    if (element) {
        element.textContent = message;
        element.classList.remove(
            "hidden",
            "error"
        );

        if (isError) {
            element.classList.add("error");
        }
    }

    if (inlineStatus) {
        inlineStatus.textContent = message;
        inlineStatus.classList.toggle(
            "inline-error",
            isError
        );
    }
}

async function refreshOpponentDeckCatalog(
    force = false
) {
    renderOpponentCatalogSummary();

    if (
        !supabaseClient ||
        !navigator.onLine
    ) {
        return;
    }

    const refreshedAt = Number(
        localStorage.getItem(
            STORAGE_KEYS.opponentDeckCatalogRefreshedAt
        ) || 0
    );

    if (
        !force &&
        opponentDeckCatalog.length > 0 &&
        Date.now() - refreshedAt <
            OPPONENT_CATALOG_TTL
    ) {
        return;
    }

    const {
        data,
        error
    } = await supabaseClient
        .from("ygo_opponent_decks")
        .select("id,name,created_at")
        .order("name", {
            ascending: true
        })
        .limit(5000);

    if (error) {
        console.warn(
            "Base de decks adverses indisponible",
            error
        );

        showCatalogStatus(
            "La base partagée n'est pas encore active. Exécute la migration SQL V6.3 dans Supabase.",
            true
        );

        return;
    }

    opponentDeckCatalog =
        normalizeOpponentDeckCatalog(
            data || []
        );

    saveOpponentDeckCatalog();

    localStorage.setItem(
        STORAGE_KEYS.opponentDeckCatalogRefreshedAt,
        String(Date.now())
    );

    renderOpponentCatalogSummary();
    renderOpponentDeckSuggestions();
}

async function addOpponentDeckToCatalog(
    rawName
) {
    const name =
        normalizeDeckLabel(rawName);

    if (name.length < 2) {
        showCatalogStatus(
            "Entre un nom de deck valide.",
            true
        );
        return false;
    }

    const existing =
        opponentDeckCatalog.find(
            (deck) =>
                normalizeDeckKey(deck.name) ===
                normalizeDeckKey(name)
        );

    if (existing) {
        showCatalogStatus(
            `${existing.name} est déjà présent dans la base.`
        );
        return true;
    }

    if (!currentUser) {
        showCatalogStatus(
            "Connecte-toi pour ajouter un nouveau deck à la base partagée.",
            true
        );
        return false;
    }

    if (!supabaseClient || !navigator.onLine) {
        showCatalogStatus(
            "Connexion cloud indisponible pour le moment.",
            true
        );
        return false;
    }

    const {
        data,
        error
    } = await supabaseClient
        .from("ygo_opponent_decks")
        .insert({
            name,
            created_by: currentUser.id
        })
        .select("id,name,created_at")
        .single();

    if (error) {
        if (error.code === "23505") {
            await refreshOpponentDeckCatalog(true);

            showCatalogStatus(
                `${name} existe déjà dans la base.`
            );
            return true;
        }

        console.error(error);
        showCatalogStatus(
            `Ajout impossible : ${error.message || error}`,
            true
        );
        return false;
    }

    opponentDeckCatalog =
        normalizeOpponentDeckCatalog([
            ...opponentDeckCatalog,
            data
        ]);

    saveOpponentDeckCatalog();

    localStorage.setItem(
        STORAGE_KEYS.opponentDeckCatalogRefreshedAt,
        String(Date.now())
    );

    renderOpponentCatalogSummary();
    renderOpponentDeckSuggestions();

    showCatalogStatus(
        `${data.name} a été ajouté à la base partagée.`
    );

    return true;
}

function getOpponentDeckSuggestions(
    rawQuery
) {
    const query = normalizeDeckKey(
        rawQuery
    );

    if (!query) {
        return [];
    }

    const starts = [];
    const contains = [];

    opponentDeckCatalog.forEach((deck) => {
        const key = normalizeDeckKey(
            deck.name
        );

        if (key.startsWith(query)) {
            starts.push(deck);
        } else if (key.includes(query)) {
            contains.push(deck);
        }
    });

    return [
        ...starts,
        ...contains
    ].slice(0, 8);
}

function renderOpponentDeckSuggestions() {
    const input =
        document.getElementById(
            "opponent-deck"
        );

    const container =
        document.getElementById(
            "opponent-deck-suggestions"
        );

    const addButton =
        document.getElementById(
            "catalog-add-from-match-button"
        );

    if (!input || !container) {
        return;
    }

    const value =
        normalizeDeckLabel(input.value);

    const suggestions =
        getOpponentDeckSuggestions(value);

    const exactMatch =
        opponentDeckCatalog.some(
            (deck) =>
                normalizeDeckKey(deck.name) ===
                normalizeDeckKey(value)
        );

    if (addButton) {
        addButton.classList.toggle(
            "hidden",
            value.length < 2 ||
                exactMatch
        );
    }

    if (
        value.length === 0 ||
        suggestions.length === 0
    ) {
        container.classList.add(
            "hidden"
        );
        container.innerHTML = "";
        return;
    }

    container.innerHTML = suggestions
        .map((deck) => `
            <button
                class="deck-suggestion-button"
                type="button"
                data-opponent-suggestion="${escapeHtml(deck.id)}"
                role="option"
            >
                <span class="suggestion-icon">⚔</span>
                <span>${escapeHtml(deck.name)}</span>
            </button>
        `)
        .join("");

    container.classList.remove(
        "hidden"
    );
}

function selectOpponentDeckSuggestion(
    deckId
) {
    const deck =
        opponentDeckCatalog.find(
            (item) =>
                String(item.id) ===
                String(deckId)
        );

    if (!deck) {
        return;
    }

    const input =
        document.getElementById(
            "opponent-deck"
        );

    if (input) {
        input.value = deck.name;
    }

    renderOpponentDeckSuggestions();

    document
        .getElementById(
            "opponent-deck-suggestions"
        )
        ?.classList.add("hidden");
}

function startEditingMatch(matchId) {
    const match = matches.find(
        (item) => item.id === matchId
    );

    if (!match) {
        return;
    }

    editingMatchId = match.id;

    document.getElementById("my-deck").value =
        match.myDeck;

    document.getElementById("opponent-deck").value =
        match.opponentDeck;

    document.getElementById("result").value =
        match.result;

    document.getElementById("score").value =
        match.score;

    document.getElementById("dice").value =
        match.dice;

    document.getElementById("tournament").value =
        match.tournamentId || "";

    setGameFormValues(
        1,
        match.games.find(
            (game) => game.number === 1
        ),
        true,
        match.position
    );

    setGameFormValues(
        2,
        match.games.find(
            (game) => game.number === 2
        ),
        false,
        ""
    );

    setGameFormValues(
        3,
        match.games.find(
            (game) => game.number === 3
        ),
        false,
        ""
    );

    document.getElementById("note").value =
        match.note || "";

    document.getElementById(
        "match-form-title"
    ).textContent = "Modifier le match";

    document.getElementById(
        "submit-match-button"
    ).textContent = "Enregistrer les modifications";

    document.getElementById(
        "cancel-edit-button"
    ).classList.remove("hidden");

    goToPage("add");
    renderDuelDeckHelpers();
}

function setGameFormValues(
    number,
    game,
    alwaysEnabled,
    fallbackPosition
) {
    if (number >= 2) {
        const checkbox = document.getElementById(
            `g${number}-played`
        );

        checkbox.checked = Boolean(game);
        toggleGameSection(number, checkbox.checked);
    }

    const position = document.getElementById(
        `g${number}-position`
    );

    const result = document.getElementById(
        `g${number}-result`
    );

    const reason = document.getElementById(
        `g${number}-reason`
    );

    const note = document.getElementById(
        `g${number}-note`
    );

    position.value =
        game?.position ||
        fallbackPosition ||
        "first";

    result.value =
        game?.result || "";

    reason.value =
        game?.reason || "";

    note.value =
        game?.note || "";

    if (number >= 2) {
        document.getElementById(
            `g${number}-side-in`
        ).value = game?.sideIn?.join("; ") || "";

        document.getElementById(
            `g${number}-side-out`
        ).value = game?.sideOut?.join("; ") || "";
    }

    const openingHandInput =
        document.getElementById(
            `g${number}-opening-hand`
        );

    if (openingHandInput) {
        openingHandInput.value =
            game?.openingHand?.join("; ") || "";
    }

    if (alwaysEnabled) {
        position.disabled = false;
        result.disabled = false;
        reason.disabled = false;
        note.disabled = false;
    }
}

function stopEditing() {
    editingMatchId = null;

    document.getElementById(
        "match-form-title"
    ).textContent = "Ajouter un match";

    document.getElementById(
        "submit-match-button"
    ).textContent = "Enregistrer le match";

    document.getElementById(
        "cancel-edit-button"
    ).classList.add("hidden");
}

function resetMatchForm() {
    const form =
        document.getElementById("match-form");

    form.reset();

    const activeDeck =
        getActiveMyDeck();

    if (activeDeck) {
        document.getElementById(
            "my-deck"
        ).value = activeDeck.name;
    }

    renderMyDeckChoices();
    renderOpponentDeckSuggestions();

    document.getElementById(
        "g1-position"
    ).value = "first";

    toggleGameSection(2, false);
    toggleGameSection(3, false);

    renderDuelDeckHelpers();
}

function toggleGameSection(number, enabled) {
    const container = document.getElementById(
        `g${number}-fields`
    );

    const fields = container.querySelectorAll(
        "input, select, textarea"
    );

    fields.forEach((field) => {
        field.disabled = !enabled;
    });

    container.classList.toggle(
        "disabled-section",
        !enabled
    );

    renderSideAssistant(number);
    renderOpeningHandPicker(number);
}

function readGameFromForm(
    formData,
    number,
    played
) {
    if (!played) {
        return null;
    }

    return {
        number,
        played: true,
        position:
            formData.get(`g${number}Position`) ||
            "",
        result:
            formData.get(`g${number}Result`) ||
            "",
        reason:
            formData.get(`g${number}Reason`) ||
            "",
        sideIn:
            number === 1
                ? []
                : parseCardList(
                    formData.get(
                        `g${number}SideIn`
                    )
                ),
        sideOut:
            number === 1
                ? []
                : parseCardList(
                    formData.get(
                        `g${number}SideOut`
                    )
                ),
        openingHand:
            parseCardList(
                formData.get(
                    `g${number}OpeningHand`
                )
            ).slice(0, 5),
        note:
            formData.get(`g${number}Note`)?.trim() ||
            ""
    };
}

function buildBackupData() {
    return {
        app: "YGO Coach",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        matches,
        tournaments,
        profile
    };
}

function createBackupFile() {
    const data = buildBackupData();

    const content = JSON.stringify(
        data,
        null,
        4
    );

    return new File(
        [
            content
        ],
        `ygo-coach-backup-${new Date().toISOString().slice(0, 10)}.json`,
        {
            type: "application/json"
        }
    );
}

function downloadBackup() {
    if (!requireAdminAction(
        "l'export de sauvegarde"
    )) {
        return;
    }

    const file = createBackupFile();
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");

    link.href = url;
    link.download = file.name;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showBackupStatus(
        "Sauvegarde exportée. Garde ce fichier : il contient tes matchs, tournois et ton profil."
    );
}

async function shareBackup() {
    if (!requireAdminAction(
        "le partage de sauvegarde"
    )) {
        return;
    }

    const file = createBackupFile();

    if (
        navigator.canShare &&
        navigator.share &&
        navigator.canShare({
            files: [
                file
            ]
        })
    ) {
        try {
            await navigator.share({
                title: "Sauvegarde YGO Coach",
                text: "Sauvegarde YGO Coach V6",
                files: [
                    file
                ]
            });

            showBackupStatus(
                "Sauvegarde prête à être envoyée vers ton autre appareil."
            );

            return;
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
        }
    }

    downloadBackup();
}

async function importBackup() {
    if (!requireAdminAction(
        "l'import de sauvegarde"
    )) {
        return;
    }

    if (!selectedImportFile) {
        showBackupStatus(
            "Choisis d'abord un fichier JSON.",
            true
        );

        return;
    }

    try {
        const content =
            await selectedImportFile.text();

        const data = JSON.parse(content);

        if (
            !data ||
            !Array.isArray(data.matches) ||
            !Array.isArray(data.tournaments)
        ) {
            throw new Error(
                "Format de sauvegarde invalide."
            );
        }

        const importedMatches =
            data.matches.map(normalizeMatch);

        const importedTournaments =
            data.tournaments.map(
                normalizeTournament
            );

        const importedProfile =
            data.profile &&
            typeof data.profile === "object"
                ? data.profile
                : {};

        const mode =
            document.getElementById(
                "import-mode"
            ).value;

        if (mode === "replace") {
            matches = importedMatches;
            tournaments = importedTournaments;
            profile = normalizeProfile(
                importedProfile
            );
        } else {
            matches = mergeById(
                matches,
                importedMatches
            );

            tournaments = mergeById(
                tournaments,
                importedTournaments
            );

            profile = normalizeProfile({
                ...profile,
                ...importedProfile
            });
        }

        saveAll();
        markAllLocalDataDirty();
        renderEverything();

        showBackupStatus(
            `Import terminé : ${importedMatches.length} match(s) et ${importedTournaments.length} tournoi(s) lus.`
        );
    } catch (error) {
        console.error(error);

        showBackupStatus(
            "Impossible d'importer ce fichier. Vérifie qu'il vient bien de YGO Coach.",
            true
        );
    }
}

function mergeById(currentItems, importedItems) {
    const merged = new Map();

    currentItems.forEach((item) => {
        merged.set(item.id, item);
    });

    importedItems.forEach((item) => {
        const current = merged.get(item.id);

        if (!current) {
            merged.set(item.id, item);
            return;
        }

        const currentDate = new Date(
            current.updatedAt ||
            current.createdAt ||
            0
        );

        const importedDate = new Date(
            item.updatedAt ||
            item.createdAt ||
            0
        );

        if (importedDate >= currentDate) {
            merged.set(item.id, item);
        }
    });

    return Array.from(merged.values());
}

function normalizeTournament(tournament) {
    return {
        id: tournament.id || generateId(),
        name: tournament.name || "Tournoi",
        createdAt:
            tournament.createdAt ||
            new Date().toISOString()
    };
}

function showBackupStatus(message, isError = false) {
    const element =
        document.getElementById("backup-status");

    element.textContent = message;
    element.classList.remove("hidden");

    if (isError) {
        element.style.background =
            "rgba(211, 82, 82, 0.09)";
        element.style.color =
            "var(--danger)";
    } else {
        element.style.background =
            "rgba(32, 163, 122, 0.09)";
        element.style.color =
            "var(--primary-strong)";
    }
}

function gameResultLabel(result) {
    if (result === "win") {
        return "Victoire";
    }

    if (result === "loss") {
        return "Défaite";
    }

    return "-";
}

function positionLabel(position) {
    if (position === "first") {
        return "Premier";
    }

    if (position === "second") {
        return "Second";
    }

    return "-";
}

function reasonLabel(reason) {
    const labels = {
        "brick": "Brick / main injouable",
        "going-second": "Going second difficile",
        "side": "Side deck",
        "handtrap": "Handtraps",
        "boardbreaker": "Board breakers",
        "misplay": "Misplay",
        "time": "Time",
        "matchup": "Connaissance du matchup",
        "opponent": "Très bon play adverse",
        "other": "Autre"
    };

    return labels[reason] || reason;
}

function emptyState(text) {
    return `
        <div class="empty-state">
            ${escapeHtml(text)}
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

document
    .querySelectorAll(".nav-button")
    .forEach((button) => {
        button.addEventListener("click", () => {
            if (
                button.dataset.page !== "add" &&
                editingMatchId
            ) {
                stopEditing();
                resetMatchForm();
            }

            goToPage(button.dataset.page);
        });
    });

document
    .querySelectorAll("[data-go-page]")
    .forEach((button) => {
        button.addEventListener("click", () => {
            goToPage(button.dataset.goPage);
        });
    });

document
    .getElementById("g2-played")
    .addEventListener("change", (event) => {
        toggleGameSection(
            2,
            event.target.checked
        );
    });

document
    .getElementById("g3-played")
    .addEventListener("change", (event) => {
        toggleGameSection(
            3,
            event.target.checked
        );
    });

document
    .getElementById(
        "card-language-select"
    )
    .addEventListener(
        "change",
        async (event) => {
            await setCardLanguage(
                event.target.value
            );
        }
    );

document
    .getElementById(
        "close-deck-builder"
    )
    .addEventListener(
        "click",
        closeDeckBuilder
    );

document
    .getElementById(
        "refresh-card-database"
    )
    .addEventListener(
        "click",
        async () => {
            await refreshCardDatabase(
                true
            );

            renderDeckBuilder();
            renderCardSearchResults();
            renderDuelDeckHelpers();
        }
    );

document
    .getElementById(
        "card-search-input"
    )
    .addEventListener(
        "focus",
        () => {
            refreshCardDatabase();
        }
    );

document
    .getElementById(
        "card-search-input"
    )
    .addEventListener(
        "input",
        () => {
            window.clearTimeout(
                cardSearchTimer
            );

            cardSearchTimer =
                window.setTimeout(
                    () => {
                        renderCardSearchResults();
                    },
                    120
                );
        }
    );

document
    .getElementById(
        "card-search-results"
    )
    .addEventListener(
        "click",
        (event) => {
            const button =
                event.target.closest(
                    "[data-add-card-id]"
                );

            if (!button) {
                return;
            }

            addCardToDeckBuilder(
                button.dataset.addCardId
            );
        }
    );

document
    .getElementById(
        "deck-builder-panel"
    )
    .addEventListener(
        "click",
        (event) => {
            const button =
                event.target.closest(
                    "[data-deck-card-action]"
                );

            if (!button) {
                return;
            }

            changeDeckCardQuantity(
                button.dataset.zone,
                button.dataset.cardId,
                button.dataset
                    .deckCardAction ===
                    "plus"
                    ? 1
                    : -1
            );
        }
    );

document.addEventListener(
    "click",
    (event) => {
        const sideButton =
            event.target.closest(
                "[data-side-game]"
            );

        if (sideButton) {
            const gameNumber =
                Number(
                    sideButton.dataset
                        .sideGame
                );

            if (
                gameNumber >= 2 &&
                !document.getElementById(
                    `g${gameNumber}-played`
                )?.checked
            ) {
                return;
            }

            cycleSideCardSelection(
                gameNumber,
                sideButton.dataset
                    .sideDirection,
                sideButton.dataset
                    .sideCardId
            );

            return;
        }

        const handButton =
            event.target.closest(
                "[data-hand-game]"
            );

        if (handButton) {
            const gameNumber =
                Number(
                    handButton.dataset
                        .handGame
                );

            if (
                gameNumber >= 2 &&
                !document.getElementById(
                    `g${gameNumber}-played`
                )?.checked
            ) {
                return;
            }

            cycleOpeningHandCard(
                gameNumber,
                handButton.dataset
                    .handCardId
            );
        }
    }
);

[
    2,
    3
].forEach(
    (gameNumber) => {
        [
            "in",
            "out"
        ].forEach(
            (direction) => {
                document
                    .getElementById(
                        `g${gameNumber}-side-${direction}`
                    )
                    .addEventListener(
                        "input",
                        () => {
                            renderSideAssistant(
                                gameNumber
                            );

                            renderOpeningHandPicker(
                                gameNumber
                            );
                        }
                    );
            }
        );
    }
);

document
    .getElementById("match-form")
    .addEventListener("submit", (event) => {
        event.preventDefault();

        const formData =
            new FormData(event.currentTarget);

        const games = [
            readGameFromForm(
                formData,
                1,
                true
            ),
            readGameFromForm(
                formData,
                2,
                document
                    .getElementById("g2-played")
                    .checked
            ),
            readGameFromForm(
                formData,
                3,
                document
                    .getElementById("g3-played")
                    .checked
            )
        ].filter(Boolean);

        const payload = {
            myDeck:
                formData
                    .get("myDeck")
                    .trim(),
            opponentDeck:
                formData
                    .get("opponentDeck")
                    .trim(),
            result:
                formData.get("result"),
            score:
                formData.get("score"),
            dice:
                formData.get("dice"),
            position:
                games[0]?.position ||
                "first",
            tournamentId:
                formData.get("tournament"),
            mistakeType:
                games.find(
                    (game) =>
                        game.result === "loss" &&
                        game.reason
                )?.reason ||
                "",
            note:
                formData
                    .get("note")
                    .trim(),
            games
        };

        let changedMatchId = editingMatchId;

        if (editingMatchId) {
            const matchIndex =
                matches.findIndex(
                    (match) =>
                        match.id === editingMatchId
                );

            if (matchIndex !== -1) {
                matches[matchIndex] = {
                    ...matches[matchIndex],
                    ...payload,
                    updatedAt:
                        new Date().toISOString()
                };
            }
        } else {
            const newMatch = {
                id: generateId(),
                ...payload,
                createdAt:
                    new Date().toISOString(),
                updatedAt:
                    new Date().toISOString()
            };

            matches.push(newMatch);
            changedMatchId = newMatch.id;
        }

        saveAll();

        if (changedMatchId) {
            markMatchDirty(
                changedMatchId
            );
        }

        stopEditing();
        resetMatchForm();
        renderEverything();
        goToPage("home");
    });

document
    .getElementById("cancel-edit-button")
    .addEventListener("click", () => {
        stopEditing();
        resetMatchForm();
        goToPage("matches");
    });

document
    .getElementById("match-filter")
    .addEventListener("change", renderMatches);

document
    .getElementById("match-search")
    .addEventListener("input", renderMatches);

document
    .getElementById("tournament-form")
    .addEventListener("submit", (event) => {
        event.preventDefault();

        const input =
            document.getElementById(
                "tournament-name"
            );

        const name = input.value.trim();

        if (!name) {
            return;
        }

        const newTournament = {
            id: generateId(),
            name,
            createdAt:
                new Date().toISOString(),
            updatedAt:
                new Date().toISOString()
        };

        tournaments.push(
            newTournament
        );

        input.value = "";

        saveAll();
        markTournamentDirty(
            newTournament.id
        );
        renderEverything();
    });

document
    .getElementById("profile-form")
    .addEventListener("submit", (event) => {
        event.preventDefault();

        const formData =
            new FormData(event.currentTarget);

        profile = normalizeProfile({
            ...profile,
            name:
                formData
                    .get("profileName")
                    .trim(),
            goal:
                formData
                    .get("profileGoal")
                    .trim(),
            updatedAt:
                new Date().toISOString()
        });

        const mainDeckName =
            formData
                .get("profileDeck")
                .trim();

        if (mainDeckName) {
            ensurePersonalDeck(
                mainDeckName,
                true
            );
        }

        saveAll();
        markProfileDirty();
        renderEverything();
        showBackupStatus(
            "Profil enregistré."
        );
    });

document
    .getElementById("export-button")
    .addEventListener("click", downloadBackup);

document
    .getElementById("share-button")
    .addEventListener("click", shareBackup);

document
    .getElementById("import-file")
    .addEventListener("change", (event) => {
        selectedImportFile =
            event.target.files?.[0] ||
            null;

        if (selectedImportFile) {
            showBackupStatus(
                `Fichier sélectionné : ${selectedImportFile.name}`
            );
        }
    });

document
    .getElementById("import-button")
    .addEventListener("click", importBackup);

document.addEventListener("click", (event) => {
    const openTournamentButton =
        event.target.closest(
            "[data-open-tournament]"
        );

    if (openTournamentButton) {
        openTournamentSummary(
            openTournamentButton.dataset
                .openTournament
        );

        return;
    }

    const closeTournamentButton =
        event.target.closest(
            "[data-close-tournament-summary]"
        );

    if (closeTournamentButton) {
        closeTournamentSummary();

        return;
    }

    const editButton = event.target.closest(
        "[data-edit-match]"
    );

    if (editButton) {
        startEditingMatch(
            editButton.dataset.editMatch
        );

        return;
    }

    const matchButton = event.target.closest(
        "[data-delete-match]"
    );

    if (matchButton) {
        const id =
            matchButton.dataset.deleteMatch;

        const confirmed = window.confirm(
            "Supprimer définitivement ce match ?"
        );

        if (!confirmed) {
            return;
        }

        matches = matches.filter(
            (match) => match.id !== id
        );

        markMatchDeleted(id);

        if (editingMatchId === id) {
            stopEditing();
            resetMatchForm();
        }

        saveAll();
        renderEverything();

        return;
    }

    const tournamentButton =
        event.target.closest(
            "[data-delete-tournament]"
        );

    if (tournamentButton) {
        const id =
            tournamentButton.dataset
                .deleteTournament;

        const confirmed = window.confirm(
            "Supprimer ce tournoi ? Les matchs associés seront conservés."
        );

        if (!confirmed) {
            return;
        }

        tournaments =
            tournaments.filter(
                (tournament) =>
                    tournament.id !== id
            );

        if (
            document
                .getElementById(
                    "tournament-summary-modal"
                )
                ?.dataset
                .tournamentId === id
        ) {
            closeTournamentSummary();
        }

        markTournamentDeleted(id);

        const affectedMatchIds = [];

        matches = matches.map((match) => {
            if (match.tournamentId === id) {
                affectedMatchIds.push(
                    match.id
                );

                return {
                    ...match,
                    tournamentId: "",
                    updatedAt:
                        new Date().toISOString()
                };
            }

            return match;
        });

        affectedMatchIds.forEach(
            markMatchDirty
        );

        saveAll();
        renderEverything();
    }
});

document
    .getElementById(
        "close-tournament-summary"
    )
    .addEventListener(
        "click",
        closeTournamentSummary
    );

document.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key === "Escape" &&
            !document
                .getElementById(
                    "tournament-summary-modal"
                )
                .classList.contains(
                    "hidden"
                )
        ) {
            closeTournamentSummary();
        }
    }
);

document
    .getElementById("reset-data-button")
    .addEventListener("click", async () => {
        if (!requireAdminAction(
            "la réinitialisation"
        )) {
            return;
        }

        const confirmed = window.confirm(
            "Cette action supprime tous les matchs, tournois et le profil de YGO Coach. Continuer ?"
        );

        if (!confirmed) {
            return;
        }

        const finalConfirmed = window.confirm(
            currentUser
                ? "Dernière confirmation : les données seront aussi supprimées du cloud pour ce compte."
                : "Dernière confirmation : as-tu exporté une sauvegarde si tu veux conserver tes données ?"
        );

        if (!finalConfirmed) {
            return;
        }

        try {
            if (
                currentUser &&
                supabaseClient
            ) {
                await deleteAllCloudData();
            }

            matches = [];
            tournaments = [];
            profile = normalizeProfile({});

            clearCloudMarkers();
            saveAll();
            stopEditing();
            resetMatchForm();
            renderEverything();
            goToPage("home");

            showBackupStatus(
                currentUser
                    ? "Données locales et cloud supprimées."
                    : "Données locales supprimées."
            );
        } catch (error) {
            console.error(error);

            showBackupStatus(
                `Suppression cloud impossible : ${error.message || error}`,
                true
            );
        }
    });


document
    .getElementById("account-shortcut")
    .addEventListener("click", async () => {
        if (!currentUser) {
            goToPage("more");

            renderRoleVisibility();

            window.setTimeout(() => {
                document
                    .getElementById(
                        "account-panel"
                    )
                    ?.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
            }, 180);

            return;
        }

        if (isAdminUser()) {
            goToPage("more");

            renderRoleVisibility();

            window.setTimeout(() => {
                document
                    .getElementById(
                        "account-panel"
                    )
                    ?.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
            }, 180);

            return;
        }

        const shouldSignOut =
            window.confirm(
                `Connecté avec ${currentUser.email}.\n\nVeux-tu te déconnecter ?`
            );

        if (shouldSignOut) {
            await signOut();
        }
    });

document
    .getElementById("open-profile-decks")
    .addEventListener("click", () => {
        goToPage("profile");
    });

document
    .getElementById("my-deck")
    .addEventListener("input", () => {
        renderMyDeckChoices();
        renderDuelDeckHelpers();
    });

document
    .getElementById("my-deck-options")
    .addEventListener("click", (event) => {
        const button =
            event.target.closest(
                "[data-pick-my-deck]"
            );

        if (!button) {
            return;
        }

        const deck = getMyDecks().find(
            (item) =>
                item.id ===
                button.dataset.pickMyDeck
        );

        if (!deck) {
            return;
        }

        document.getElementById(
            "my-deck"
        ).value = deck.name;

        renderMyDeckChoices();
        renderDuelDeckHelpers();
    });

document
    .getElementById("my-deck-form")
    .addEventListener("submit", (event) => {
        event.preventDefault();

        const input =
            document.getElementById(
                "new-my-deck-name"
            );

        const name =
            normalizeDeckLabel(
                input.value
            );

        if (!name) {
            return;
        }

        const makeActive =
            getMyDecks().length === 0;

        const createdDeck =
            ensurePersonalDeck(
                name,
                makeActive
            );

        profile.updatedAt =
            new Date().toISOString();

        input.value = "";

        saveAll();
        markProfileDirty();
        renderEverything();

        if (createdDeck) {
            openDeckBuilder(
                createdDeck.id
            );
        }
    });

document
    .getElementById("my-decks-list")
    .addEventListener("click", (event) => {
        const selectButton =
            event.target.closest(
                "[data-select-personal-deck]"
            );

        const buildButton =
            event.target.closest(
                "[data-build-personal-deck]"
            );

        const deleteButton =
            event.target.closest(
                "[data-delete-personal-deck]"
            );

        if (buildButton) {
            openDeckBuilder(
                buildButton.dataset
                    .buildPersonalDeck
            );

            return;
        }

        if (selectButton) {
            const deckId =
                selectButton.dataset
                    .selectPersonalDeck;

            const deck = getMyDecks().find(
                (item) =>
                    item.id === deckId
            );

            if (!deck) {
                return;
            }

            profile.activeDeckId =
                deck.id;
            profile.deck = deck.name;
            profile.updatedAt =
                new Date().toISOString();

            saveAll();
            markProfileDirty();
            renderEverything();
            return;
        }

        if (deleteButton) {
            const deckId =
                deleteButton.dataset
                    .deletePersonalDeck;

            const deck = getMyDecks().find(
                (item) =>
                    item.id === deckId
            );

            if (!deck) {
                return;
            }

            if (!window.confirm(
                `Supprimer ${deck.name} de tes decks ? Tes anciens matchs ne seront pas modifiés.`
            )) {
                return;
            }

            profile.decks =
                getMyDecks().filter(
                    (item) =>
                        item.id !== deckId
                );

            if (
                deckBuilderDeckId ===
                deckId
            ) {
                closeDeckBuilder();
            }

            if (
                profile.activeDeckId ===
                deckId
            ) {
                profile.activeDeckId =
                    profile.decks[0]?.id ||
                    "";
            }

            profile.deck =
                profile.decks.find(
                    (item) =>
                        item.id ===
                        profile.activeDeckId
                )?.name || "";

            profile.updatedAt =
                new Date().toISOString();

            saveAll();
            markProfileDirty();
            renderEverything();
        }
    });

document
    .getElementById("opponent-deck")
    .addEventListener("input", () => {
        renderOpponentDeckSuggestions();
    });

document
    .getElementById("opponent-deck")
    .addEventListener("focus", () => {
        refreshOpponentDeckCatalog();
        renderOpponentDeckSuggestions();
    });

document
    .getElementById("opponent-deck-suggestions")
    .addEventListener("click", (event) => {
        const button =
            event.target.closest(
                "[data-opponent-suggestion]"
            );

        if (!button) {
            return;
        }

        selectOpponentDeckSuggestion(
            button.dataset
                .opponentSuggestion
        );
    });

document
    .getElementById("catalog-add-from-match-button")
    .addEventListener("click", async () => {
        const input =
            document.getElementById(
                "opponent-deck"
            );

        const added =
            await addOpponentDeckToCatalog(
                input.value
            );

        if (added) {
            renderOpponentDeckSuggestions();
        }
    });

document
    .getElementById("opponent-catalog-form")
    .addEventListener("submit", async (event) => {
        event.preventDefault();

        const input =
            document.getElementById(
                "catalog-deck-name"
            );

        const added =
            await addOpponentDeckToCatalog(
                input.value
            );

        if (added) {
            input.value = "";
        }
    });

document.addEventListener(
    "click",
    (event) => {
        const field =
            event.target.closest(
                ".autocomplete-field"
            );

        if (!field) {
            document
                .getElementById(
                    "opponent-deck-suggestions"
                )
                ?.classList.add(
                    "hidden"
                );
        }
    }
);

document
    .getElementById("auth-form")
    .addEventListener("submit", (event) => {
        event.preventDefault();
        signIn();
    });

document
    .getElementById("sign-up-button")
    .addEventListener("click", signUp);

document
    .getElementById("forgot-password-button")
    .addEventListener("click", sendPasswordReset);

document
    .getElementById("sign-out-button")
    .addEventListener("click", signOut);

document
    .getElementById("sync-now-button")
    .addEventListener("click", () => {
        syncWithCloud("manual");
    });

toggleGameSection(2, false);
toggleGameSection(3, false);
renderEverything();
renderRoleVisibility();
updateCardLanguageUi();
initializeCloudAuth();

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./sw.js")
            .catch((error) => {
                console.warn(
                    "Service worker non enregistré :",
                    error
                );
            });
    });
}
