const API_BASE = '/api';
let currentLocation = null;
let currentUser = null;

// ============ AUTH MANAGEMENT ============

function getToken() {
    return localStorage.getItem('token');
}

function setToken(token) {
    localStorage.setItem('token', token);
}

function removeToken() {
    localStorage.removeItem('token');
}

async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    if (!token) {
        throw new Error('No authentication token');
    }
    
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    // If body is present, set Content-Type to JSON
    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        // Token expired or invalid
        logout();
        throw new Error('Authentication expired');
    }
    
    return response;
}

function showLoginForm() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('registerError').classList.add('hidden');
}

function showRegisterForm() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('registerError').classList.add('hidden');
}

async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            errorDiv.textContent = error.detail || 'Login failed';
            errorDiv.classList.remove('hidden');
            return;
        }
        
        const data = await response.json();
        setToken(data.access_token);
        await initializeApp();
        
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.classList.remove('hidden');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const errorDiv = document.getElementById('registerError');
    
    try {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            errorDiv.textContent = error.detail || 'Registration failed';
            errorDiv.classList.remove('hidden');
            return;
        }
        
        const data = await response.json();
        setToken(data.access_token);
        await initializeApp();
        
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.classList.remove('hidden');
    }
}

async function getCurrentUser() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/auth/me`);
        if (response.ok) {
            currentUser = await response.json();
            return currentUser;
        }
    } catch (error) {
        console.error('Error getting current user:', error);
        return null;
    }
}

async function initializeApp() {
    const user = await getCurrentUser();
    if (!user) {
        logout();
        return;
    }
    
    // Show main app, hide auth
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    // Update UI with user info
    document.getElementById('currentUsername').textContent = user.username;
    
    // Load user data
    loadStats();
    loadLocations();
}

function logout() {
    removeToken();
    currentUser = null;
    
    // Hide main app, show auth
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('authContainer').classList.remove('hidden');
    
    // Reset forms
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerEmail').value = '';
    document.getElementById('registerPassword').value = '';
    
    showLoginForm();
}

// ============ APP INITIALIZATION ============

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    const token = getToken();
    if (token) {
        await initializeApp();
    } else {
        showLoginForm();
    }
});

// ============ LOCATION CAPTURE ============

// Capture current location
async function captureLocation() {
    const btn = document.getElementById('captureBtn');
    const statusText = document.getElementById('statusText');
    
    btn.disabled = true;
    btn.classList.remove('pulse-btn');
    statusText.textContent = 'Getting your location...';
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        btn.disabled = false;
        btn.classList.add('pulse-btn');
        statusText.textContent = 'Click to save your current location';
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            // Try to get altitude from GPS (not always available)
            let altitude = position.coords.altitude;
            
            // If altitude not available from GPS, try to get it from an elevation API
            if (!altitude) {
                try {
                    altitude = await fetchElevation(latitude, longitude);
                } catch (error) {
                    console.error('Could not fetch elevation:', error);
                }
            }
            
            currentLocation = {
                latitude,
                longitude,
                altitude: altitude ? Math.round(altitude) : null
            };
            
            // Show modal for optional note
            showNoteModal();
            
            btn.disabled = false;
            btn.classList.add('pulse-btn');
            statusText.textContent = 'Location captured! Add a note...';
        },
        (error) => {
            console.error('Error getting location:', error);
            alert('Could not get your location. Please enable location services.');
            btn.disabled = false;
            btn.classList.add('pulse-btn');
            statusText.textContent = 'Click to save your current location';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Fetch elevation from Open-Elevation API (free, no API key needed)
async function fetchElevation(lat, lon) {
    try {
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`);
        const data = await response.json();
        return data.results[0].elevation;
    } catch (error) {
        console.error('Elevation API error:', error);
        return null;
    }
}

// Show note modal
function showNoteModal() {
    document.getElementById('noteModal').classList.add('show');
    document.getElementById('noteInput').focus();
}

// Close note modal
function closeNoteModal() {
    document.getElementById('noteModal').classList.remove('show');
    document.getElementById('noteInput').value = '';
    document.getElementById('statusText').textContent = 'Click to save your current location';
}

// Save location with note
async function saveLocationWithNote() {
    const note = document.getElementById('noteInput').value.trim();
    
    const locationData = {
        ...currentLocation,
        note: note || null
    };
    
    // Debug: log what we're sending
    console.log('Saving location:', locationData);
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/locations`, {
            method: 'POST',
            body: JSON.stringify(locationData)
        });
        
        if (response.ok) {
            const savedLocation = await response.json();
            console.log('Location saved:', savedLocation);
            closeNoteModal();
            
            // Show success message
            const statusText = document.getElementById('statusText');
            statusText.textContent = '✓ Location saved successfully!';
            statusText.classList.add('text-green-600');
            
            setTimeout(() => {
                statusText.textContent = 'Click to save your current location';
                statusText.classList.remove('text-green-600');
            }, 3000);
            
            // Reload data
            loadStats();
            loadLocations();
        } else {
            // Get error details
            const errorData = await response.json().catch(() => ({}));
            console.error('Save error:', errorData);
            const errorMessage = errorData.detail || `Failed to save location (${response.status})`;
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Error saving location:', error);
        alert(`Failed to save location: ${error.message}`);
        closeNoteModal();
    }
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/stats`);
        const stats = await response.json();
        
        document.getElementById('totalPoints').textContent = stats.total_points;
        document.getElementById('highestAltitude').textContent = 
            stats.highest_altitude ? Math.round(stats.highest_altitude) : '-';
        document.getElementById('lowestAltitude').textContent = 
            stats.lowest_altitude ? Math.round(stats.lowest_altitude) : '-';
        document.getElementById('avgAltitude').textContent = 
            stats.average_altitude ? Math.round(stats.average_altitude) : '-';
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load locations
async function loadLocations() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/locations`);
        const locations = await response.json();
        
        const listContainer = document.getElementById('locationsList');
        
        if (locations.length === 0) {
            listContainer.innerHTML = `
                <p>No locations captured yet. Click the button above to save your first point!</p>
            `;
        } else {
            listContainer.innerHTML = locations.map(loc => createLocationCard(loc)).join('');
        }
        
    } catch (error) {
        console.error('Error loading locations:', error);
    }
}

// Create location card HTML
function createLocationCard(location) {
    const date = new Date(location.timestamp);
    const formattedDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    return `
        <div class="location-item">
            <p><strong>Location:</strong> ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}</p>
            ${location.altitude ? `<p><strong>Altitude:</strong> ${Math.round(location.altitude)}m</p>` : ''}
            ${location.note ? `<p><strong>Note:</strong> ${location.note}</p>` : ''}
            <p><strong>Time:</strong> ${formattedDate}</p>
            <button onclick="deleteLocation(${location.id})" class="delete-btn">Delete</button>
        </div>
    `;
}

// Delete location
async function deleteLocation(id) {
    if (!confirm('Are you sure you want to delete this location?')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/locations/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadStats();
            loadLocations();
        } else {
            throw new Error('Failed to delete location');
        }
    } catch (error) {
        console.error('Error deleting location:', error);
        alert('Failed to delete location. Please try again.');
    }
}

// Clear all locations
async function clearAllLocations() {
    if (!confirm('Are you sure you want to delete ALL locations? This cannot be undone!')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/locations`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadStats();
            loadLocations();
        } else {
            throw new Error('Failed to clear locations');
        }
    } catch (error) {
        console.error('Error clearing locations:', error);
        alert('Failed to clear locations. Please try again.');
    }
}