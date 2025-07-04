// script.js

// --- Global Constants & Elements ---
const ITUNES_API_BASE_URL = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_BASE_URL = 'https://itunes.apple.com/lookup';

const elements = {
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    clearBtn: document.getElementById('clearBtn'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    statusMessage: document.getElementById('statusMessage'),
    searchResults: document.getElementById('searchResults'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    currentYearSpan: document.getElementById('currentYear'),
    detailsModal: document.getElementById('detailsModal'),
    closeModalBtn: document.querySelector('.close-button'),
    modalBody: document.getElementById('modalBody')
};

// --- State Variables ---
let currentAudio = null; // To manage currently playing audio
let currentPlayingButton = null; // To keep track of the button controlling currentAudio
let currentSearchQuery = '';
let currentMediaType = 'song'; // Default filter: tracks (songs)
let currentOffset = 0; // For pagination/load more
const resultsLimit = 20; // Number of results to fetch per call

// --- Lazy Loading Observer ---
const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.getAttribute('data-src');
            if (src) {
                img.src = src;
                img.onload = () => {
                    img.classList.add('loaded'); // Add class when image is loaded
                };
            }
            observer.unobserve(img); // Stop observing once loaded
        }
    });
}, { rootMargin: '0px 0px 100px 0px' }); // Load when 100px from viewport

// --- Utility Functions ---

/**
 * Displays a message in the status area with dynamic styling.
 * @param {string} message - The message text.
 * @param {'info'|'loading'|'error'|'success'} type - Type of message for styling.
 * @param {number} duration - How long the message should be visible in ms. 0 for indefinite.
 */
function showStatusMessage(message, type = 'info', duration = 3000) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = `status-message show ${type}`;
    if (duration > 0) {
        setTimeout(() => hideStatusMessage(), duration);
    }
}

function hideStatusMessage() {
    elements.statusMessage.classList.remove('show');
    setTimeout(() => {
        elements.statusMessage.textContent = '';
        elements.statusMessage.className = 'status-message';
    }, 300); // Allow fade-out animation
}

/**
 * Toggles the loading state for UI elements and shows skeleton loaders.
 * @param {boolean} isLoading - True to enable loading state, false to disable.
 * @param {boolean} isInitialLoad - True if it's the very first search (clear existing results).
 */
function toggleLoadingState(isLoading, isInitialLoad = true) {
    elements.searchBtn.disabled = isLoading;
    elements.clearBtn.disabled = isLoading;
    elements.searchInput.disabled = isLoading;
    elements.filterButtons.forEach(btn => btn.disabled = isLoading);
    elements.loadMoreBtn.disabled = isLoading;

    if (isLoading) {
        showStatusMessage('Searching for music...', 'loading', 0);
        if (isInitialLoad) {
            elements.searchResults.innerHTML = generateSkeletonLoaders(8); // Show 8 skeletons for initial search
            elements.loadMoreBtn.classList.add('hidden'); // Hide load more during initial search
        } else {
             // For "load more", append skeletons
            elements.searchResults.insertAdjacentHTML('beforeend', generateSkeletonLoaders(4)); // Append 4 for load more
        }
    } else {
        hideStatusMessage();
    }
}

/**
 * Generates skeleton loaders for the results grid.
 * @param {number} count - Number of skeletons to generate.
 * @returns {string} HTML string of skeleton loaders.
 */
function generateSkeletonLoaders(count) {
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="music-card skeleton">
                <div class="skeleton-img"></div>
                <div class="music-card-content">
                    <div class="skeleton-text skeleton-title"></div>
                    <div class="skeleton-text skeleton-artist"></div>
                    <div class="skeleton-text skeleton-album"></div>
                    <div class="skeleton-text skeleton-genre"></div>
                    <div class="skeleton-button"></div>
                </div>
            </div>
        `;
    }
    return skeletonHtml;
}

/**
 * Stops any currently playing audio.
 */
function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        console.log('Audio stopped.');
    }
    if (currentPlayingButton) {
        currentPlayingButton.innerHTML = '<i class="fas fa-play"></i>';
        currentPlayingButton.classList.remove('playing');
    }
    currentAudio = null;
    currentPlayingButton = null;
}

/**
 * Plays or pauses an audio preview.
 * @param {string} previewUrl - The URL of the audio preview.
 * @param {HTMLElement} button - The button element that triggered the play.
 */
function toggleAudioPlayback(previewUrl, button) {
    if (!previewUrl) {
        showStatusMessage('No audio preview available for this item.', 'info', 3000);
        return;
    }

    // Check if the clicked button is already playing the current audio
    const isSameAudio = currentAudio && currentAudio.src === previewUrl;
    const isSameButton = currentPlayingButton === button;

    if (isSameAudio && isSameButton) {
        // If the same audio is playing and same button clicked, pause it
        stopCurrentAudio();
    } else {
        // Stop any previously playing audio
        stopCurrentAudio();

        // Start new audio
        currentAudio = new Audio(previewUrl);
        currentAudio.volume = 0.7; // Set default volume
        currentAudio.play()
            .then(() => {
                console.log('Playing audio:', previewUrl);
                button.innerHTML = '<i class="fas fa-pause"></i>';
                button.classList.add('playing');
                currentPlayingButton = button;

                // Listen for when audio ends
                currentAudio.onended = () => {
                    console.log('Audio finished.');
                    stopCurrentAudio();
                };
            })
            .catch(error => {
                console.error('Error playing audio:', error);
                showStatusMessage('Failed to play audio. The preview might not be available or there was a network error.', 'error', 5000);
                stopCurrentAudio(); // Reset button state
            });
    }
}


// --- Search & Fetch Data Functions ---

/**
 * Initiates a new search or loads more results.
 * @param {boolean} isLoadMore - True if this is a "Load More" action.
 */
async function getMusicData(isLoadMore = false) {
    const query = elements.searchInput.value.trim();
    if (!query && !isLoadMore) {
        showStatusMessage('Please enter a search query.', 'error', 5000);
        elements.searchResults.innerHTML = '<p class="placeholder-text">Start by searching for your favorite music!</p>';
        elements.loadMoreBtn.classList.add('hidden');
        return;
    }

    currentSearchQuery = query; // Update current query for subsequent load more calls

    if (!isLoadMore) {
        currentOffset = 0; // Reset offset for new search
        toggleLoadingState(true, true); // Initial load, clear results
        elements.loadMoreBtn.classList.add('hidden');
    } else {
        toggleLoadingState(true, false); // Loading more, append skeletons
    }
    stopCurrentAudio(); // Stop any playing audio when a new search starts

    const url = `${ITUNES_API_BASE_URL}?term=${encodeURIComponent(currentSearchQuery)}&entity=${currentMediaType}&limit=${resultsLimit}&offset=${currentOffset}`;
    console.log("Fetching URL:", url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('iTunes API Response:', data);

        if (!isLoadMore) {
            renderSearchResults(data.results); // Render initial results
        } else {
            appendSearchResults(data.results); // Append new results
        }

        if (data.resultCount === 0 && !isLoadMore) {
             showStatusMessage(`No ${currentMediaType}s found for "${currentSearchQuery}". Try a different query or filter!`, 'info', 5000);
             elements.searchResults.innerHTML = '<p class="placeholder-text">No music found for your search. Try a different query or filter!</p>';
        } else if (!isLoadMore) {
             showStatusMessage(`Found ${data.resultCount} results for "${currentSearchQuery}".`, 'info', 4000);
        } else {
            // For load more, just update current offset and hide message quickly
             hideStatusMessage();
        }

        // Show "Load More" button if there might be more results
        // This is a heuristic, as iTunes API doesn't tell total results readily
        if (data.results.length === resultsLimit) {
            elements.loadMoreBtn.classList.remove('hidden');
            currentOffset += resultsLimit; // Increment offset for next load
        } else {
            elements.loadMoreBtn.classList.add('hidden'); // No more results to load
        }

    } catch (error) {
        console.error('Error fetching music data:', error);
        showStatusMessage(`Error fetching music data: ${error.message}. Please try again.`, 'error', 8000);
        if (!isLoadMore) {
            elements.searchResults.innerHTML = '<p class="placeholder-text">Failed to load results. Please check your internet connection.</p>';
        } else {
            // If load more fails, just remove skeletons and keep existing results
            const skeletons = elements.searchResults.querySelectorAll('.skeleton');
            skeletons.forEach(s => s.remove());
        }
        elements.loadMoreBtn.classList.add('hidden');
    } finally {
        toggleLoadingState(false);
    }
}

/**
 * Fetches detailed information for an album or artist.
 * @param {string} id - The collectionId (for album) or artistId.
 * @param {string} type - 'album' or 'artist'.
 */
async function fetchDetails(id, type) {
    elements.modalBody.innerHTML = `
        <div class="skeleton-modal-body">
            <div class="skeleton-img large"></div>
            <div class="skeleton-text skeleton-modal-title"></div>
            <div class="skeleton-text skeleton-modal-subtitle"></div>
            <div class="skeleton-text skeleton-modal-para"></div>
            <div class="skeleton-text skeleton-modal-para short"></div>
            <ul class="skeleton-list">
                <li><div class="skeleton-text"></div></li>
                <li><div class="skeleton-text"></div></li>
                <li><div class="skeleton-text"></div></li>
                <li><div class="skeleton-text"></div></li>
                <li><div class="skeleton-text"></div></li>
            </ul>
        </div>
    `; // Show skeleton in modal
    elements.detailsModal.classList.add('show');

    let url;
    if (type === 'album') {
        url = `${ITUNES_LOOKUP_BASE_URL}?id=${id}&entity=song`; // Get all songs in an album
    } else if (type === 'artist') {
        url = `${ITUNES_LOOKUP_BASE_URL}?id=${id}&entity=song&limit=10`; // Get top 10 songs by artist
    } else {
        console.error('Unsupported detail type:', type);
        elements.modalBody.innerHTML = '<p class="text-center">Details not available.</p>';
        return;
    }
    console.log('Fetching details URL:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Details API Response:', data);

        renderDetailsModal(data.results, type);

    } catch (error) {
        console.error(`Error fetching ${type} details:`, error);
        elements.modalBody.innerHTML = `<p class="text-center error-message">Failed to load details: ${error.message}</p>`;
    }
}


// --- Render Results Functions ---

/**
 * Renders initial search results. Clears existing content.
 * @param {Array} results - Array of music items.
 */
function renderSearchResults(results) {
    elements.searchResults.innerHTML = ''; // Clear previous results
    appendSearchResults(results); // Use append function
}

/**
 * Appends new search results to the grid.
 * @param {Array} results - Array of music items to append.
 */
function appendSearchResults(results) {
    if (!results || results.length === 0) {
        // If no results on initial search AND no existing content
        if (elements.searchResults.innerHTML.trim() === generateSkeletonLoaders(8).trim()) { // Check if only skeletons are there
            elements.searchResults.innerHTML = '<p class="placeholder-text">No music found for your search. Try a different query or filter!</p>';
        }
        return;
    }

    // Remove any skeletons left before appending
    const skeletons = elements.searchResults.querySelectorAll('.skeleton');
    skeletons.forEach(s => s.remove());

    results.forEach(item => {
        // Determine the primary type for card display
        let type = '';
        if (item.wrapperType === 'track' && item.kind === 'song') {
            type = 'track';
        } else if (item.wrapperType === 'collection' && item.collectionType === 'Album') {
            type = 'album';
        } else if (item.wrapperType === 'artist') {
            type = 'artist';
        } else {
            return; // Skip unsupported types
        }

        const card = document.createElement('div');
        card.classList.add('music-card');
        card.setAttribute('data-item-type', type);

        let title, subtitle1, subtitle2, artworkUrl, itemId;
        let previewUrl = item.previewUrl || ''; // Preview only for tracks

        switch (type) {
            case 'track':
                title = item.trackName || 'Unknown Track';
                subtitle1 = `Artist: ${item.artistName || 'Unknown'}`;
                subtitle2 = `Album: ${item.collectionName || 'Unknown'}`;
                artworkUrl = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '400x400bb') : 'https://via.placeholder.com/400?text=No+Image';
                itemId = item.trackId; // Could be used for track details later
                previewUrl = item.previewUrl; // Only tracks have previewUrl directly
                break;
            case 'album':
                title = item.collectionName || 'Unknown Album';
                subtitle1 = `Artist: ${item.artistName || 'Unknown'}`;
                subtitle2 = `Tracks: ${item.trackCount || 'N/A'}`;
                artworkUrl = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '400x400bb') : 'https://via.placeholder.com/400?text=No+Image';
                itemId = item.collectionId;
                break;
            case 'artist':
                title = item.artistName || 'Unknown Artist';
                subtitle1 = `Genre: ${item.primaryGenreName || 'N/A'}`;
                subtitle2 = `Type: ${item.artistType || 'N/A'}`;
                artworkUrl = 'https://via.placeholder.com/400?text=Artist'; // Artists often don't have direct artwork in search
                itemId = item.artistId;
                break;
        }

        card.setAttribute('data-preview-url', previewUrl);
        card.setAttribute('data-item-id', itemId);

        // Placeholder for lazy loading
        const placeholderSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23f0f0f0'/%3E%3Ctext x='50%' y='50%' font-family='Arial, sans-serif' font-size='30' fill='%23ccc' text-anchor='middle' dominant-baseline='middle'%3ELoading...%3C/text%3E%3C/svg%3E`;

        card.innerHTML = `
            <img src="${placeholderSvg}" data-src="${artworkUrl}" alt="${title}">
            <div class="music-card-content">
                <h3>${title}</h3>
                <p>${subtitle1}</p>
                <p>${subtitle2}</p>
                ${type === 'track' && previewUrl ? `
                    <button class="play-button" aria-label="Play preview of ${title}">
                        <i class="fas fa-play"></i>
                    </button>
                ` : ''}
            </div>
        `;
        elements.searchResults.appendChild(card);

        // Observe the image for lazy loading
        const imgElement = card.querySelector('img');
        if (imgElement) {
            observer.observe(imgElement);
        }
    });
}

/**
 * Renders the content for the details modal.
 * @param {Array} results - Data from the lookup API.
 * @param {string} type - 'album' or 'artist'.
 */
function renderDetailsModal(results, type) {
    elements.modalBody.innerHTML = ''; // Clear skeleton/previous content
    stopCurrentAudio(); // Stop any audio playing in the main grid

    if (!results || results.length === 0) {
        elements.modalBody.innerHTML = '<p class="text-center">No details available.</p>';
        return;
    }

    const mainItem = results[0]; // First item is usually the primary album/artist
    let contentHtml = '';
    let artwork = mainItem.artworkUrl100 ? mainItem.artworkUrl100.replace('100x100bb', '600x600bb') : 'https://via.placeholder.com/600?text=No+Image';

    if (type === 'album') {
        const tracks = results.slice(1); // First result is album, rest are tracks
        contentHtml = `
            <img src="${artwork}" alt="${mainItem.collectionName}">
            <h2>${mainItem.collectionName || 'Unknown Album'}</h2>
            <p><strong>Artist:</strong> ${mainItem.artistName || 'Unknown Artist'}</p>
            <p><strong>Genre:</strong> ${mainItem.primaryGenreName || 'N/A'}</p>
            <p><strong>Release Date:</strong> ${mainItem.releaseDate ? new Date(mainItem.releaseDate).toLocaleDateString() : 'N/A'}</p>
            <p><strong>Total Tracks:</strong> ${mainItem.trackCount || 'N/A'}</p>
            <h3>Tracks:</h3>
            ${tracks.length > 0 ? `
                <ul>
                    ${tracks.map(track => `
                        <li>
                            <span>${track.trackName || 'Unknown Track'}</span>
                            ${track.previewUrl ? `
                                <button class="track-play-button" data-preview-url="${track.previewUrl}" aria-label="Play preview of ${track.trackName}">
                                    <i class="fas fa-play"></i>
                                </button>
                            ` : ''}
                        </li>
                    `).join('')}
                </ul>
            ` : '<p>No tracks found for this album.</p>'}
        `;
    } else if (type === 'artist') {
        const topTracks = results.filter(item => item.wrapperType === 'track'); // Filter for tracks by the artist
        artwork = 'https://via.placeholder.com/600?text=Artist'; // Artists rarely have good direct artwork from search
        if (mainItem.artistViewUrl) { // Try to get a better image from a potential artist page if possible (complex for iTunes)
             // For a real app, you might fetch from a different API for artist images
        }


        contentHtml = `
            <img src="${artwork}" alt="${mainItem.artistName}">
            <h2>${mainItem.artistName || 'Unknown Artist'}</h2>
            <p><strong>Genre:</strong> ${mainItem.primaryGenreName || 'N/A'}</p>
            ${topTracks.length > 0 ? `
                <h3>Top Tracks:</h3>
                <ul>
                    ${topTracks.map(track => `
                        <li>
                            <span>${track.trackName || 'Unknown Track'}</span>
                            ${track.previewUrl ? `
                                <button class="track-play-button" data-preview-url="${track.previewUrl}" aria-label="Play preview of ${track.trackName}">
                                    <i class="fas fa-play"></i>
                                </button>
                            ` : ''}
                        </li>
                    `).join('')}
                </ul>
            ` : '<p>No top tracks found for this artist.</p>'}
        `;
    }

    elements.modalBody.innerHTML = contentHtml;
}


// --- Event Listeners ---

elements.searchBtn.addEventListener('click', () => {
    getMusicData(false); // New search
});

elements.searchInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        elements.searchBtn.click();
    }
});

elements.clearBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.searchResults.innerHTML = '<p class="placeholder-text">Start by searching for your favorite music!</p>';
    hideStatusMessage();
    stopCurrentAudio();
    elements.loadMoreBtn.classList.add('hidden');
    elements.searchInput.focus();
    currentOffset = 0; // Reset offset on clear
});

elements.loadMoreBtn.addEventListener('click', () => {
    getMusicData(true); // Load more results
});

// Filter button event listeners
elements.filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        elements.filterButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        currentMediaType = button.getAttribute('data-entity');
        console.log('Filter set to:', currentMediaType);
        // Trigger a new search with the updated filter
        getMusicData(false);
    });
});

// Event delegation for play buttons on music cards
elements.searchResults.addEventListener('click', (event) => {
    const playButton = event.target.closest('.play-button');
    if (playButton) {
        // This is a play button on a search result card
        const musicCard = playButton.closest('.music-card');
        const previewUrl = musicCard ? musicCard.getAttribute('data-preview-url') : null;
        toggleAudioPlayback(previewUrl, playButton);
    } else {
        // Handle clicks on the card itself to open details modal
        const musicCard = event.target.closest('.music-card:not(.skeleton)'); // Ensure it's not a skeleton
        if (musicCard) {
            const itemId = musicCard.getAttribute('data-item-id');
            const itemType = musicCard.getAttribute('data-item-type');
            if (itemId && (itemType === 'album' || itemType === 'artist')) {
                fetchDetails(itemId, itemType);
            } else if (itemType === 'track') {
                showStatusMessage("Click play for preview. No additional details for tracks yet.", "info", 3000);
            }
        }
    }
});

// Event delegation for play buttons inside the modal
elements.modalBody.addEventListener('click', (event) => {
    const playButton = event.target.closest('.track-play-button');
    if (playButton) {
        const previewUrl = playButton.getAttribute('data-preview-url');
        toggleAudioPlayback(previewUrl, playButton);
    }
});

// Modal close button
elements.closeModalBtn.addEventListener('click', () => {
    elements.detailsModal.classList.remove('show');
    stopCurrentAudio(); // Stop audio when modal closes
});

// Close modal when clicking outside of modal content
window.addEventListener('click', (event) => {
    if (event.target === elements.detailsModal) {
        elements.detailsModal.classList.remove('show');
        stopCurrentAudio(); // Stop audio when modal closes
    }
});

// Close modal with ESC key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.detailsModal.classList.contains('show')) {
        elements.detailsModal.classList.remove('show');
        stopCurrentAudio();
    }
});


// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    elements.currentYearSpan.textContent = new Date().getFullYear();
    elements.searchInput.focus(); // Focus on search input on load
});