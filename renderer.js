// Global Application State
const profileInitializedKey = 'flash_profile_initialized';
if (localStorage.getItem(profileInitializedKey) !== 'true') {
    localStorage.clear();
    localStorage.setItem(profileInitializedKey, 'true');
}

let urls = [];
try {
    const storedUrls = JSON.parse(localStorage.getItem('flash_urls') || '[]');
    if (Array.isArray(storedUrls)) urls = storedUrls;
} catch {
    localStorage.removeItem('flash_urls');
}
let appPin = localStorage.getItem('flash_pin') || null;
let parsedImportItems = [];

// Security & Privacy Settings State
let inactivityTimeoutSetting = parseInt(localStorage.getItem('flash_timeout')) || 300000; // default 5 mins
let pinEnabledState = localStorage.getItem('flash_pin_disabled') !== 'true';
let privacyBlurActive = false;
let configuredHotkey = localStorage.getItem('flash_hotkey') || 'Control+KeyB'; // Default Ctrl+B
let isRecordingHotkey = false;

let inactivityTimer = null;
let isBrowserViewActive = false;
let browserTabs = [];
let activeBrowserTabId = null;
let nextBrowserTabId = 1;

// Initialization on Load
document.addEventListener('DOMContentLoaded', () => {
    if (pinEnabledState && appPin) {
        document.getElementById('pin-screen').classList.remove('hidden');
        document.getElementById('pin-input').focus();
    } else {
        document.getElementById('pin-screen').classList.add('hidden');
        document.getElementById('onboard-screen').classList.remove('hidden');
    }

    // Enter key support for PIN entry
    document.getElementById('pin-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') unlockVault();
    });
    document.getElementById('pin-btn').addEventListener('click', unlockVault);

    // Activity tracking & Global Hotkey listener
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
        window.addEventListener(evt, resetInactivityTimer);
    });

    window.addEventListener('keydown', handleGlobalKeydown);
    if (window.flashBridge) {
        window.flashBridge.onBrowserOpenTab(url => openBrowser(url));
        window.flashBridge.onBrowserSaveBookmark(() => saveCurrentBookmark());
    }
    document.querySelectorAll('.search-preference').forEach(select => {
        select.addEventListener('change', updateSearchQueryPreview);
    });
});

// --- Security & Setup ---
function nextOnboardStep(step) {
    const pin = document.getElementById('setup-pin').value.trim();
    if (step === 2) {
        if (pin.length < 4) {
            return alert('Please enter a secure PIN of at least 4 digits.');
        }
        appPin = pin;
        localStorage.setItem('flash_pin', appPin);
        document.getElementById('onboard-step-1').classList.add('hidden');
        document.getElementById('onboard-step-2').classList.remove('hidden');
    }
}

function completeOnboarding() {
    document.getElementById('onboard-screen').classList.add('hidden');
    initApp();
}

function unlockVault() {
    const enteredPin = document.getElementById('pin-input').value.trim();
    if (enteredPin === appPin) {
        document.getElementById('pin-screen').classList.add('hidden');
        initApp();
    } else {
        alert('Incorrect PIN code.');
        document.getElementById('pin-input').value = '';
        document.getElementById('pin-input').focus();
    }
}

function resetVaultData() {
    if (confirm('Are you sure you want to wipe everything and reset your PIN?')) {
        localStorage.clear();
        location.reload();
    }
}

function initApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('nav-menu').classList.remove('hidden');
    
    // Sync settings values in UI
    const pinToggle = document.getElementById('setting-pin-toggle');
    if (pinToggle) pinToggle.checked = pinEnabledState;
    
    const timeoutSelect = document.getElementById('setting-timeout');
    if (timeoutSelect) timeoutSelect.value = inactivityTimeoutSetting;

    const hotkeyInput = document.getElementById('setting-hotkey');
    if (hotkeyInput) hotkeyInput.value = formatHotkeyDisplay(configuredHotkey);

    updateStorageStats();
    renderBookmarks();
    resetInactivityTimer();
}

// --- Navigation Tabs ---
function switchTab(tabName) {
    const tabs = ['home', 'browser', 'bookmarks', 'add', 'settings'];
    isBrowserViewActive = tabName === 'browser';
    resetInactivityTimer();
    tabs.forEach(t => {
        const viewEl = document.getElementById(`view-${t}`);
        const tabEl = document.getElementById(`tab-${t}`);
        if (viewEl) viewEl.classList.add('hidden');
        if (tabEl) {
            tabEl.classList.remove('bg-[#22222c]', 'text-white');
            tabEl.classList.add('text-gray-400');
        }
    });

    const activeView = document.getElementById(`view-${tabName}`);
    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeView) activeView.classList.remove('hidden');
    if (activeTab) {
        activeTab.classList.add('bg-[#22222c]', 'text-white');
        activeTab.classList.remove('text-gray-400');
    }

    if (tabName === 'bookmarks') {
        renderBookmarks();
    }
    if (tabName === 'browser') {
        updateBrowserControls();
        updateBrowserPrivacyBlur();
    }
    if (tabName === 'settings') {
        updateStorageStats();
    }
}

// --- URL & Bookmark Management ---
function saveUrl() {
    const name = document.getElementById('url-name').value.trim();
    const link = document.getElementById('url-link').value.trim();
    const tagsInput = document.getElementById('url-tags').value.trim();

    if (!name || !link) {
        return alert('Please enter both a title and a valid URL.');
    }

    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    urls.push({ id: Date.now(), name, link, tags });
    localStorage.setItem('flash_urls', JSON.stringify(urls));
    updateBrowserPrivacyBlur();

    document.getElementById('url-name').value = '';
    document.getElementById('url-link').value = '';
    document.getElementById('url-tags').value = '';

    switchTab('bookmarks');
}

function saveCurrentBookmark() {
    const tab = browserTabs.find(item => item.id === activeBrowserTabId);
    if (!tab) return;

    const link = tab.webview.getURL() || tab.url;
    if (!isSupportedBookmarkUrl(link)) return;

    const existing = urls.find(item => item.link === link);
    if (existing) {
        existing.name = tab.title && tab.title !== 'New Tab' ? tab.title : existing.name;
        localStorage.setItem('flash_urls', JSON.stringify(urls));
        renderBookmarks();
        return;
    }

    const item = {
        id: Date.now(),
        name: tab.title && tab.title !== 'New Tab' ? tab.title : new URL(link).hostname,
        link,
        tags: [],
        description: '',
        previewImage: '',
        favicon: ''
    };
    urls.unshift(item);
    localStorage.setItem('flash_urls', JSON.stringify(urls));
    renderBookmarks();

    tab.webview.executeJavaScript(`(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '',
        previewImage: document.querySelector('meta[property="og:image"]')?.content || document.querySelector('meta[name="twitter:image"]')?.content || '',
        favicon: document.querySelector('link[rel~="icon"]')?.href || ''
    }))()`).then(metadata => {
        const resolveAsset = value => {
            try {
                const asset = new URL(value, link);
                return ['http:', 'https:'].includes(asset.protocol) ? asset.href : '';
            } catch {
                return '';
            }
        };

        item.name = metadata.title || item.name;
        item.description = metadata.description || '';
        item.previewImage = resolveAsset(metadata.previewImage);
        item.favicon = resolveAsset(metadata.favicon);
        localStorage.setItem('flash_urls', JSON.stringify(urls));
        renderBookmarks();
    }).catch(() => {});
}

function deleteUrl(id) {
    if (confirm('Delete this flash link?')) {
        urls = urls.filter(item => item.id !== id);
        localStorage.setItem('flash_urls', JSON.stringify(urls));
        renderBookmarks();
        updateBrowserPrivacyBlur();
    }
}

function renderBookmarks() {
    const container = document.getElementById('bookmarks-container');
    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    
    if (!container) return;
    container.innerHTML = '';

    const filtered = urls.filter(item =>
        item && typeof item.name === 'string' && typeof item.link === 'string' && (
            item.name.toLowerCase().includes(query) ||
            item.link.toLowerCase().includes(query) ||
            (Array.isArray(item.tags) && item.tags.some(tag => typeof tag === 'string' && tag.toLowerCase().includes(query)))
        )
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 bg-[#121217] border border-[#22222c] rounded-2xl">
                <p class="text-xs text-gray-400 mb-1">No bookmarks found</p>
                <p class="text-[10px] text-gray-500">Add links manually or import an HTML bookmark file.</p>
            </div>`;
        return;
    }

    filtered.forEach(item => {
        const tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [];
        const isNsfw = isNsfwBookmark(item);
        
        const card = document.createElement('div');
        const blurClass = (privacyBlurActive && isNsfw) ? 'privacy-blur' : '';
        
        card.className = `bg-[#121217] border border-[#22222c] p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-3 hover:border-blue-500/40 transition-all shadow-md group ${blurClass}`;
        
        let tagsHtml = '';
        if (tags.length > 0) {
            tagsHtml = `<div class="flex items-center space-x-1 mt-1">` + 
                tags.map(t => `<span class="bg-[#1a1a22] text-gray-400 text-[10px] px-2 py-0.5 rounded-md border border-[#22222c]">${escapeHtml(t)}</span>`).join('') +
                `</div>`;
        }

        const safeName = escapeHtml(item.name);
        const safeLink = escapeHtml(item.link);
        let host = '';
        try {
            host = new URL(item.link).hostname.replace(/^www\./, '');
        } catch {}
        const previewSource = item.previewImage || item.favicon;
        const safePreviewSource = escapeHtml(previewSource || '');
        const safeHost = escapeHtml(host);
        const safeDescription = escapeHtml(item.description || '');
        const fallbackInitial = escapeHtml((host || item.name).charAt(0).toUpperCase());

        card.innerHTML = `
            <div class="w-full h-28 sm:w-32 sm:h-20 flex-shrink-0 rounded-lg overflow-hidden bg-[#0a0a0c] border border-[#22222c]">
            <span class="bookmark-fallback w-full h-full flex items-center justify-center text-xl font-semibold text-gray-500">${fallbackInitial}</span>
            ${previewSource ? `<img class="bookmark-preview w-full h-full object-cover" src="${safePreviewSource}" alt="" loading="lazy">` : ''}
            </div>
            <div class="space-y-1 overflow-hidden pr-2 flex-grow min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                    <h3 class="text-xs font-semibold text-white truncate">${safeName}</h3>
                    <span class="text-[10px] text-gray-500 truncate flex-shrink-0">${safeHost}</span>
                </div>
                <p class="text-[11px] text-gray-400 truncate">${safeDescription || safeLink}</p>
                ${tagsHtml}
            </div>
            <div class="flex items-center space-x-2 flex-shrink-0">
                <button class="open-bookmark bg-blue-600 hover:bg-blue-500 text-white text-xs px-3.5 py-2 rounded-xl transition-all shadow-md active:scale-95 font-medium">Open</button>
                <button class="delete-bookmark bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs p-2 rounded-xl transition-all active:scale-95" title="Delete">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
        `;
        const preview = card.querySelector('.bookmark-preview');
        if (preview) {
            card.querySelector('.bookmark-fallback').classList.add('hidden');
            preview.addEventListener('error', () => {
                preview.classList.add('hidden');
                card.querySelector('.bookmark-fallback').classList.remove('hidden');
            });
        }
        card.querySelector('.open-bookmark').addEventListener('click', () => openBrowser(item.link));
        card.querySelector('.delete-bookmark').addEventListener('click', () => deleteUrl(item.id));
        container.appendChild(card);
    });
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// --- Privacy Blur & Hotkey Management ---
function togglePrivacyBlur() {
    privacyBlurActive = !privacyBlurActive;
    
    const btnText = document.getElementById('privacy-btn-text');
    const toggleBtn = document.getElementById('privacy-toggle-btn');
    
    if (privacyBlurActive) {
        if (btnText) btnText.textContent = 'Blur: On';
        if (toggleBtn) toggleBtn.classList.add('border-blue-500/50', 'text-blue-400', 'bg-blue-600/10');
    } else {
        if (btnText) btnText.textContent = 'Blur: Off';
        if (toggleBtn) toggleBtn.classList.remove('border-blue-500/50', 'text-blue-400', 'bg-blue-600/10');
    }

    renderBookmarks();
    updateBrowserPrivacyBlur();
}

function isNsfwBookmark(item) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return tags.some(tag => typeof tag === 'string' && ['nsfw', 'hidden'].includes(tag.toLowerCase()));
}

function updateBrowserPrivacyBlur() {
    const markedHosts = new Set();
    if (privacyBlurActive) {
        urls.filter(isNsfwBookmark).forEach(item => {
            try {
                markedHosts.add(new URL(item.link).hostname);
            } catch {}
        });
    }

    browserTabs.forEach(tab => {
        let host = '';
        try {
            host = new URL(tab.url).hostname;
        } catch {}
        const isMarkedHost = host && Array.from(markedHosts).some(markedHost =>
            host === markedHost || host.endsWith(`.${markedHost}`) || markedHost.endsWith(`.${host}`)
        );
        tab.webview.classList.toggle('privacy-blur', Boolean(isMarkedHost));
    });
}

function recordHotkey(event) {
    isRecordingHotkey = true;
    const input = event.target;
    input.value = 'Press key combination...';
    input.classList.add('border-blue-500');

    const captureKey = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
            isRecordingHotkey = false;
            input.value = formatHotkeyDisplay(configuredHotkey);
            input.classList.remove('border-blue-500');
            window.removeEventListener('keydown', captureKey);
            return;
        }

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        let comboParts = [];
        if (e.ctrlKey) comboParts.push('Control');
        if (e.shiftKey) comboParts.push('Shift');
        if (e.altKey) comboParts.push('Alt');
        comboParts.push(e.code);

        configuredHotkey = comboParts.join('+');
        localStorage.setItem('flash_hotkey', configuredHotkey);

        input.value = formatHotkeyDisplay(configuredHotkey);
        input.classList.remove('border-blue-500');
        isRecordingHotkey = false;
        window.removeEventListener('keydown', captureKey);
    };

    window.addEventListener('keydown', captureKey);
}

function clearHotkey() {
    configuredHotkey = '';
    localStorage.removeItem('flash_hotkey');
    const input = document.getElementById('setting-hotkey');
    if (input) input.value = 'None (Click to set)';
}

function formatHotkeyDisplay(hotkeyStr) {
    if (!hotkeyStr) return 'None (Click to set)';
    return hotkeyStr
        .replace('Control', 'Ctrl')
        .replace('Key', '')
        .replace('Digit', '');
}

function handleGlobalKeydown(e) {
    if (isRecordingHotkey) return;

    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        saveCurrentBookmark();
        return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        createBrowserTab('https://www.google.com');
        return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'w' && activeBrowserTabId !== null) {
        e.preventDefault();
        closeBrowserTab(activeBrowserTabId);
        return;
    }

    let comboParts = [];
    if (e.ctrlKey) comboParts.push('Control');
    if (e.shiftKey) comboParts.push('Shift');
    if (e.altKey) comboParts.push('Alt');
    comboParts.push(e.code);

    const currentCombo = comboParts.join('+');
    if (configuredHotkey && currentCombo === configuredHotkey) {
        e.preventDefault();
        togglePrivacyBlur();
    }
}

// --- In-App Browser ---
function showBrowser() {
    switchTab('browser');
    if (activeBrowserTabId === null) createBrowserTab('https://www.google.com');
}

function openBrowser(targetUrl = '') {
    if (!targetUrl) targetUrl = 'https://www.google.com';

    try {
        createBrowserTab(normalizeBrowserInput(targetUrl));
    } catch {
        alert('Please enter a valid HTTP or HTTPS URL.');
    }
}

function normalizeBrowserInput(value) {
    const input = value.trim();
    if (!input) throw new Error('Input is empty.');
    if (/\s/.test(input) || (!input.includes('.') && !/^https?:\/\//i.test(input) && !input.includes(':'))) {
        return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
    }

    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol.');
    return url.href;
}

function createBrowserTab(targetUrl = 'about:blank') {
    const id = nextBrowserTabId++;
    const tab = { id, url: targetUrl, title: 'New Tab', webview: null };
    const webview = document.createElement('webview');
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
    webview.src = targetUrl;
    tab.webview = webview;

    ['did-navigate', 'did-navigate-in-page'].forEach(eventName => {
        webview.addEventListener(eventName, () => {
            tab.url = webview.getURL();
            updateBrowserPrivacyBlur();
            if (activeBrowserTabId === id) {
                document.getElementById('browser-url-input').value = tab.url;
                updateBrowserControls();
            }
        });
    });
    webview.addEventListener('page-title-updated', event => {
        tab.title = event.title || tab.url;
        renderBrowserTabs();
    });
    webview.addEventListener('did-stop-loading', () => {
        if (activeBrowserTabId === id) updateBrowserControls();
    });

    document.getElementById('browser-webviews').appendChild(webview);
    browserTabs.push(tab);
    selectBrowserTab(id);
}

function selectBrowserTab(id) {
    const tab = browserTabs.find(item => item.id === id);
    if (!tab) return;
    activeBrowserTabId = id;
    browserTabs.forEach(item => item.webview.classList.toggle('active', item.id === id));
    document.getElementById('browser-url-input').value = tab.url === 'about:blank' ? '' : tab.url;
    renderBrowserTabs();
    switchTab('browser');
    updateBrowserControls();
    updateBrowserPrivacyBlur();
}

function closeBrowserTab(id) {
    const index = browserTabs.findIndex(item => item.id === id);
    if (index === -1) return;
    browserTabs[index].webview.remove();
    browserTabs.splice(index, 1);
    if (activeBrowserTabId === id) {
        const nextTab = browserTabs[Math.min(index, browserTabs.length - 1)];
        activeBrowserTabId = null;
        if (nextTab) selectBrowserTab(nextTab.id);
        else createBrowserTab('about:blank');
    } else {
        renderBrowserTabs();
    }
}

function renderBrowserTabs() {
    const container = document.getElementById('browser-tabs');
    container.querySelectorAll('.browser-tab').forEach(element => element.remove());
    const newTabButton = container.querySelector('[aria-label="New browser tab"]');
    browserTabs.forEach(tab => {
        const button = document.createElement('button');
        button.className = `browser-tab flex items-center gap-2 flex-shrink-0 max-w-52 px-3 h-8 rounded-lg text-xs text-gray-400 hover:text-white ${tab.id === activeBrowserTabId ? 'active' : ''}`;
        button.title = tab.url;
        button.innerHTML = `<span class="truncate">${escapeHtml(tab.title || tab.url || 'New Tab')}</span><span class="browser-tab-close text-gray-500 hover:text-white" aria-label="Close tab">×</span>`;
        button.addEventListener('click', event => {
            if (event.target.closest('.browser-tab-close')) closeBrowserTab(tab.id);
            else selectBrowserTab(tab.id);
        });
        container.insertBefore(button, newTabButton);
    });
}

function navigateBrowserFromInput() {
    const tab = browserTabs.find(item => item.id === activeBrowserTabId);
    if (!tab) return createBrowserTab(document.getElementById('browser-url-input').value.trim());
    const targetUrl = document.getElementById('browser-url-input').value.trim();
    if (!targetUrl) return;
    try {
        tab.url = normalizeBrowserInput(targetUrl);
        tab.webview.src = tab.url;
        renderBrowserTabs();
    } catch {
        alert('Please enter a valid HTTP or HTTPS URL.');
    }
}

function openSearchModal() {
    const modal = document.getElementById('search-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    updateSearchQueryPreview();
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function getPreferenceSearchTerms() {
    return Array.from(document.querySelectorAll('.search-preference'))
        .map(select => select.value.trim())
        .filter(Boolean);
}

function updateSearchQueryPreview() {
    const terms = getPreferenceSearchTerms();
    document.getElementById('search-query-preview').textContent = terms.length
        ? terms.join(' ')
        : 'Select preferences to build a query.';
}

function runPreferenceSearch() {
    const query = getPreferenceSearchTerms().join(' ');
    if (!query) return alert('Choose at least one preference to search.');

    closeSearchModal();
    openBrowser(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

function browserGoBack() {
    const webview = getActiveBrowserWebview();
    if (webview && webview.canGoBack()) webview.goBack();
}

function browserGoForward() {
    const webview = getActiveBrowserWebview();
    if (webview && webview.canGoForward()) webview.goForward();
}

function browserReload() {
    const webview = getActiveBrowserWebview();
    if (webview) webview.reload();
}

function updateBrowserControls() {
    const webview = getActiveBrowserWebview();
    if (!webview) return;

    try {
        document.getElementById('browser-back').disabled = !webview.canGoBack();
        document.getElementById('browser-forward').disabled = !webview.canGoForward();
    } catch {
        document.getElementById('browser-back').disabled = true;
        document.getElementById('browser-forward').disabled = true;
    }
}

function getActiveBrowserWebview() {
    return browserTabs.find(tab => tab.id === activeBrowserTabId)?.webview || null;
}

// --- Inactivity Auto-Lock Management ---
function resetInactivityTimer() {
    if (!appPin || !pinEnabledState || inactivityTimeoutSetting === 0) return;
    
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (isBrowserViewActive) {
            resetInactivityTimer();
            return;
        }
        lockVault();
    }, inactivityTimeoutSetting);
}

function lockVault() {
    const appScreen = document.getElementById('app-screen');
    const pinScreen = document.getElementById('pin-screen');
    
    if (appScreen && pinScreen && pinEnabledState && appPin) {
        appScreen.classList.add('hidden');
        pinScreen.classList.remove('hidden');
        document.getElementById('pin-input').value = '';
        document.getElementById('pin-input').focus();
    }
}

function updateTimeoutSetting() {
    const select = document.getElementById('setting-timeout');
    inactivityTimeoutSetting = parseInt(select.value);
    localStorage.setItem('flash_timeout', inactivityTimeoutSetting);
    resetInactivityTimer();
}

// --- PIN Toggle & Management ---
function togglePinRequirement() {
    const toggle = document.getElementById('setting-pin-toggle');
    pinEnabledState = toggle.checked;
    localStorage.setItem('flash_pin_disabled', !pinEnabledState);
}

function updatePin() {
    const newPin = document.getElementById('new-pin').value.trim();
    if (newPin.length < 4) {
        return alert('PIN must be at least 4 digits long.');
    }
    appPin = newPin;
    localStorage.setItem('flash_pin', appPin);
    document.getElementById('new-pin').value = '';
    alert('Vault PIN updated successfully.');
}

// --- Storage Statistics ---
function updateStorageStats() {
    const itemsCountEl = document.getElementById('stat-items-count');
    const storageSizeEl = document.getElementById('stat-storage-size');
    
    if (!itemsCountEl || !storageSizeEl) return;

    itemsCountEl.textContent = urls.length;

    let totalBytes = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            totalBytes += (localStorage[key].length + key.length) * 2;
        }
    }

    const kbSize = (totalBytes / 1024).toFixed(1);
    storageSizeEl.textContent = `${kbSize} KB`;
}

// --- Bookmark Import Handling ---
function handleBookmarkImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        parsedImportItems = [];
        if (file.name.toLowerCase().endsWith('.json')) {
            try {
                parsedImportItems = parseFlashBackup(e.target.result);
            } catch (error) {
                return alert(error.message);
            }
        } else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(e.target.result, 'text/html');
            doc.querySelectorAll('a').forEach(anchor => {
                const name = anchor.textContent.trim();
                const link = anchor.href;
                if (name && isSupportedBookmarkUrl(link)) {
                    parsedImportItems.push({ name, link, selected: true });
                }
            });
        }

        if (parsedImportItems.length === 0) {
            return alert('No valid bookmark links found in the uploaded file.');
        }

        renderImportModalList();
        document.getElementById('import-modal').classList.remove('hidden');
    };
    reader.readAsText(file);
    event.target.value = '';
}

function parseFlashBackup(content) {
    let backup;
    try {
        backup = JSON.parse(content);
    } catch {
        throw new Error('This is not a valid Flash backup JSON file.');
    }

    if (!backup || backup.format !== 'flash-bookmarks' || backup.version !== 1 || !Array.isArray(backup.bookmarks)) {
        throw new Error('This Flash backup format or version is not supported.');
    }

    const bookmarks = backup.bookmarks;
    const validBookmarks = bookmarks.every(item =>
        item && typeof item.name === 'string' && item.name.trim() &&
        typeof item.link === 'string' && isSupportedBookmarkUrl(item.link)
    );
    if (!validBookmarks) {
        throw new Error('The Flash backup contains invalid bookmark entries.');
    }

    return bookmarks.map(item => ({
        name: item.name.trim(),
        link: item.link.trim(),
        tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [],
        selected: true
    }));
}

function isSupportedBookmarkUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function renderImportModalList() {
    const listEl = document.getElementById('import-list');
    listEl.innerHTML = '';

    parsedImportItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = "flex items-center space-x-3 bg-[#1a1a22] border border-[#22222c] p-2.5 rounded-xl";
        div.innerHTML = `
            <input type="checkbox" id="import-item-${index}" ${item.selected ? 'checked' : ''} onchange="toggleImportItem(${index})" class="rounded bg-[#0a0a0c] border-[#22222c] text-blue-600 focus:ring-0">
            <label for="import-item-${index}" class="text-xs text-gray-200 truncate cursor-pointer flex-grow">
                <span class="font-medium text-white block truncate">${escapeHtml(item.name)}</span>
                <span class="text-[10px] text-gray-500 truncate block">${escapeHtml(item.link)}</span>
            </label>
        `;
        listEl.appendChild(div);
    });
}

function toggleImportItem(index) {
    parsedImportItems[index].selected = !parsedImportItems[index].selected;
}

function closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
    parsedImportItems = [];
}

function confirmImport() {
    const selectedItems = parsedImportItems.filter(i => i.selected);
    selectedItems.forEach(item => {
        urls.push({
            id: Date.now() + Math.random(),
            name: item.name,
            link: item.link,
            tags: Array.isArray(item.tags) ? item.tags : ['imported']
        });
    });

    localStorage.setItem('flash_urls', JSON.stringify(urls));
    closeImportModal();
    switchTab('bookmarks');
}

// --- Export Bookmarks Feature ---
function exportBookmarks() {
    if (urls.length === 0) {
        return alert('No bookmarks or flashes available to export.');
    }

    let htmlContent = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n`;
    htmlContent += `<!-- This is an automatically generated file format by Flash -->\n`;
    htmlContent += `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n`;
    htmlContent += `<TITLE>Bookmarks</TITLE>\n`;
    htmlContent += `<H1>Bookmarks</H1>\n`;
    htmlContent += `<DL><p>\n`;
    htmlContent += `    <DT><H3 ADD_DATE="${Math.floor(Date.now()/1000)}" LAST_MODIFIED="${Math.floor(Date.now()/1000)}">Flash Vault Exports</H3>\n`;
    htmlContent += `    <DL><p>\n`;

    urls.forEach(item => {
        const safeName = item.name.replace(/"/g, '&quot;');
        const safeLink = item.link.replace(/"/g, '&quot;');
        htmlContent += `        <DT><A HREF="${safeLink}" ADD_DATE="${Math.floor(Date.now()/1000)}">${safeName}</A>\n`;
    });

    htmlContent += `    </DL><p>\n`;
    htmlContent += `</DL><p>\n`;

    downloadExport(htmlContent, 'text/html', 'flash_bookmarks_export.html');
}

function exportFlashBackup() {
    if (urls.length === 0) {
        return alert('No bookmarks or flashes available to export.');
    }

    const backup = {
        format: 'flash-bookmarks',
        version: 1,
        exportedAt: new Date().toISOString(),
        bookmarks: urls
    };
    downloadExport(JSON.stringify(backup, null, 2), 'application/json', 'flash_bookmarks_backup.json');
}

function downloadExport(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearData() {
    if (confirm('WARNING: This will permanently delete all bookmarks and reset your security PIN. Proceed?')) {
        localStorage.clear();
        location.reload();
    }
}