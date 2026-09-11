const STORAGE_KEYS = {
    matches: "ygoCoachMatches",
    tournaments: "ygoCoachTournaments",
    profile: "ygoCoachProfile",
    linkedUser: "ygoCoachLinkedUserId",
    dirtyMatches: "ygoCoachDirtyMatches",
    dirtyTournaments: "ygoCoachDirtyTournaments",
    dirtyProfile: "ygoCoachDirtyProfile",
    deletedMatches: "ygoCoachDeletedMatches",
    deletedTournaments: "ygoCoachDeletedTournaments"
};

const LEGACY_STORAGE_KEYS = {
    matches: "ygoMatches"
};

const APP_VERSION = 6;

let matches = loadMatches();
let tournaments = loadArray(STORAGE_KEYS.tournaments);
let profile = loadObject(STORAGE_KEYS.profile);
let editingMatchId = null;
let selectedImportFile = null;

let supabaseClient = null;
let currentUser = null;
let cloudSyncInProgress = false;
let cloudSyncQueued = false;
let cloudSyncTimer = null;
let cloudPollTimer = null;

function generateId() {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    return String(value || "")
        .split(/[,;\n]/)
        .map((item) => item.trim())
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
        setCloudStatus("local", "Local");
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
        return;
    }

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

    if (!cloudPollTimer) {
        cloudPollTimer = window.setInterval(() => {
            if (
                currentUser &&
                document.visibilityState === "visible"
            ) {
                requestCloudSync(0);
            }
        }, 30000);
    }

    document.addEventListener(
        "visibilitychange",
        () => {
            if (
                currentUser &&
                document.visibilityState === "visible"
            ) {
                requestCloudSync(500);
            }
        }
    );
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

    if (!currentUser) {
        setCloudStatus(
            "local",
            "Local"
        );

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
        !supabaseClient
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

            profile = mergeProfile(
                profile,
                cloud.profile
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
            profile = cloud.profile;

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
                profile = cloud.profile;
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

    setCloudStatus(
        "local",
        "Local"
    );

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
                game.sideOut.length
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

            return `
                <div class="game-summary-row ${gameClass}">
                    <span>G${game.number}</span>

                    <strong>
                        ${gameResultLabel(game.result)}
                    </strong>

                    <div>
                        ${escapeHtml(positionLabel(game.position))}
                        ${sideText}
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
                <article class="tournament-card">
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

                        <strong>
                            ${formatPercent(winrateForMatches(tournamentMatches))}
                        </strong>
                    </div>

                    <div class="match-actions">
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
    document.getElementById("profile-name").value =
        profile.name || "";

    document.getElementById("profile-deck").value =
        profile.deck || "";

    document.getElementById("profile-goal").value =
        profile.goal || "";
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
        ).value = game?.sideIn?.join(", ") || "";

        document.getElementById(
            `g${number}-side-out`
        ).value = game?.sideOut?.join(", ") || "";
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

    document.getElementById(
        "g1-position"
    ).value = "first";

    toggleGameSection(2, false);
    toggleGameSection(3, false);
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
            profile = importedProfile;
        } else {
            matches = mergeById(
                matches,
                importedMatches
            );

            tournaments = mergeById(
                tournaments,
                importedTournaments
            );

            profile = {
                ...profile,
                ...importedProfile
            };
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

        profile = {
            ...profile,
            name:
                formData
                    .get("profileName")
                    .trim(),
            deck:
                formData
                    .get("profileDeck")
                    .trim(),
            goal:
                formData
                    .get("profileGoal")
                    .trim(),
            updatedAt:
                new Date().toISOString()
        };

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
    .getElementById("reset-data-button")
    .addEventListener("click", async () => {
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
            profile = {};

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
    .addEventListener("click", () => {
        goToPage("more");
    });

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
