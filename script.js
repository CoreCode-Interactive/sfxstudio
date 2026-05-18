let supabaseClient = null;
let currentBucket = "cue-media";

let projectorWindow = null;
let currentAudio = null;
let cues = [];
let currentCueIndex = -1;


// --- 1. BACKEND INITIALIZATION (BYOB MODEL) ---
function initBackend() {
    const savedUrl = localStorage.getItem('sfx_supabase_url');
    const savedKey = localStorage.getItem('sfx_supabase_key');
    const savedBucket = localStorage.getItem('sfx_supabase_bucket');
    const configModal = document.getElementById('configModal');

    if (savedUrl && savedKey) {
        supabaseClient = supabase.createClient(savedUrl, savedKey);
        currentBucket = savedBucket || "cue-media";
        
        if (configModal) configModal.style.display = 'none';
        console.log("Personal Supabase instance connected.");

        // CRITICAL FIX: Fetch the files as soon as we know we are connected safely
        fetchSupabaseFiles();
    } else {
        if (configModal) configModal.style.display = 'flex';
    }
}

// Production-safe initialization check
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initBackend);
} else {
    initBackend();
}

// Automatically check backend status on document load
window.addEventListener('DOMContentLoaded', initBackend);

function saveSupabaseConfig(event) {
    event.preventDefault();
    const url = document.getElementById('dbUrl').value.trim();
    const key = document.getElementById('dbKey').value.trim();
    const bucket = document.getElementById('dbBucket').value.trim();

    localStorage.setItem('sfx_supabase_url', url);
    localStorage.setItem('sfx_supabase_key', key);
    localStorage.setItem('sfx_supabase_bucket', bucket);

    initBackend();
}

function disconnectBackend() {
    if (confirm("Disconnect from your Supabase storage? Your cues will not fire until you reconnect.")) {
        localStorage.clear();
        location.reload();
    }
}

// --- 2. PROJECTOR MANAGEMENT ---
function launchProjector() {
    projectorWindow = window.open("projector.html", "Projector", "width=1280,height=720");
    
    const status = document.getElementById('windowStatus');
    if (status) {
        status.innerText = "Projector Deployed";
        status.className = "status-online";
    }
}

// --- 3. CUE MANAGEMENT (Direct File Upload to Cloud) ---
async function addCue() {
    const type = document.getElementById('typeInput').value;
    const source = document.getElementById('sourceInput').value; // Get chosen source
    const fileInput = document.getElementById('filePicker');
    const addBtn = document.querySelector('.btn-add');
    
    if (!supabaseClient) return alert("Connect your Supabase database first!");

    let finalFileName = "";
    let finalPath = "";

    try {
        addBtn.innerText = source === 'computer' ? "Uploading..." : "Adding...";
        addBtn.disabled = true;

        // ==========================================
        // PATH A: PULL FILE FROM COMPUTER & UPLOAD IT
        // ==========================================
        if (source === 'computer') {
            if (fileInput.files.length === 0) {
                alert("Select a file from your computer first!");
                return;
            }

            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const uniqueName = `${Date.now()}.${fileExt}`;

            // 1. Upload raw binary file straight to user's bucket
            const { error: uploadError } = await supabaseClient.storage
                .from(currentBucket)
                .upload(uniqueName, file);

            if (uploadError) throw uploadError;

            // 2. Extract public streamable tracking link
            const { data: urlData } = supabaseClient.storage
                .from(currentBucket)
                .getPublicUrl(uniqueName);

            finalFileName = file.name;
            finalPath = urlData.publicUrl;

        // ==========================================
        // PATH B: GRAB EXISTING FILE FROM SUPABASE
        // ==========================================
        } else if (source === 'supabase') {
            const supabaseDropdown = document.getElementById('supabaseFilePicker');
            const selectedFile = supabaseDropdown.value;

            if (!selectedFile) {
                alert("Please select a file from the Supabase list first!");
                return;
            }

            // Get the instant public URL since it's already uploaded
            const { data: urlData } = supabaseClient.storage
                .from(currentBucket)
                .getPublicUrl(selectedFile);

            finalFileName = selectedFile;
            finalPath = urlData.publicUrl;
        }

        // ==========================================
        // SHARED: REGISTER AND RENDER THE CUE
        // ==========================================
        const newCue = {
            id: Date.now(),
            type: type,
            fileName: finalFileName,
            path: finalPath, 
            needsLinking: false
        };

        cues.push(newCue);
        renderCues();
        
        // Reset local input just in case
        fileInput.value = ""; 

    } catch (err) {
        console.error("Upload/Add error details:", err);
        alert("Action failed! Verify that your bucket name is typed accurately, your keys are correct, and your bucket settings are toggled to Public.\n\nError: " + err.message);
    } finally {
        addBtn.innerText = "+ Add Cue";
        addBtn.disabled = false;
    }
}

// --- 4. THE FIRE ENGINE ---
function fireCue(cue) {
    
    if (cue.type === 'audio') {
        if (currentAudio) currentAudio.pause();
        currentAudio = new Audio(cue.path);
        currentAudio.play();
        return;
    }

    if (!projectorWindow || projectorWindow.closed) {
        return alert("Launch Projector First!");
    }

    const container = projectorWindow.document.getElementById('display-container');
    
    if (!container) {
        setTimeout(() => fireCue(cue), 250);
        return;
    }

    const newMedia = projectorWindow.document.createElement(cue.type === 'image' ? 'img' : 'video');
    newMedia.className = "media-item";
    
    const startTransition = () => {
        const oldItems = container.querySelectorAll('.media-item');
        oldItems.forEach(item => {
            item.classList.remove('visible');
            setTimeout(() => item.remove(), 1200);
        });

        container.appendChild(newMedia);
        setTimeout(() => {
            newMedia.classList.add('visible');
            if (cue.type === 'video') {
                newMedia.muted = false;
                newMedia.play().catch(err => console.error("Video play aborted:", err));
            }
        }, 50);
    };

    if (cue.type === 'image') {
        newMedia.onload = startTransition;
    } else {
        newMedia.oncanplaythrough = startTransition;
    }

    newMedia.src = cue.path;
    if (cue.type === 'video') newMedia.load();
}

// --- 5. NAVIGATION & UTILITIES ---
function playNextCue() {
    if (cues.length === 0) return;
    currentCueIndex = (currentCueIndex + 1) % cues.length;
    
    fireCue(cues[currentCueIndex]);
    renderCues();
}

function stopEverything() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (projectorWindow && !projectorWindow.closed) {
        const container = projectorWindow.document.getElementById('display-container');
        if (container) container.innerHTML = "";
    }
}

function renderCues() {
    const container = document.getElementById('cueList');
    if (!container) return;
    container.innerHTML = "";

    cues.forEach((cue, index) => {
        const div = document.createElement('div');
        
        // If this cue matches our tracked active index, visually select it
        if (index === currentCueIndex) {
            div.className = "cue-box selected";
        } else {
            div.className = "cue-box";
        }

        div.onclick = () => {
            currentCueIndex = index; // Sync our tracker index to the clicked item
            fireCue(cue);
            renderCues();            // Re-render immediately to update visual borders
        };

        div.innerHTML = `
            <div class="cue-info">
                <span class="cue-type">${cue.type.toUpperCase()}</span>
                <span class="cue-name">${cue.fileName}</span>
            </div>
            <button class="btn-delete" onclick="removeCue(event, ${cue.id})">Delete</button>
        `;
        container.appendChild(div);
    });
}

function removeCue(e, id) {
    e.stopPropagation();
    cues = cues.filter(c => c.id !== id);
    renderCues();
}

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === "Space") {
        e.preventDefault();
        playNextCue();
    }
    if (e.key === "Escape") {
        stopEverything();
    }
});

function updateFileFilters() {
    const type = document.getElementById('typeInput').value;
    const picker = document.getElementById('filePicker');
    if (type === 'image') picker.accept = "image/*";
    else if (type === 'video') picker.accept = "video/*";
    else if (type === 'audio') picker.accept = "audio/*";
}

function saveShow() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cues));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "show_cues.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function loadShow(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            cues = JSON.parse(e.target.result);
            currentCueIndex = -1; // Reset tracker back to safety before rendering
            renderCues();
        } catch (err) {
            alert("Invalid show file structural data.");
        }
    };
    reader.readAsText(file);
}

// 1. Toggle visibility between local upload and cloud fetch
function toggleSourceInput() {
    const source = document.getElementById('sourceInput').value;
    const localGroup = document.getElementById('localFileGroup');
    const supabaseGroup = document.getElementById('supabaseFileGroup');

    if (source === 'supabase') {
        localGroup.style.display = 'none';
        supabaseGroup.style.display = 'block';
        fetchSupabaseFiles(); // Fetch the files automatically when selected
    } else {
        localGroup.style.display = 'block';
        supabaseGroup.style.display = 'none';
    }
}

async function fetchSupabaseFiles() {
    const selectDropdown = document.getElementById('supabaseFilePicker');
    if (!selectDropdown) return;
    
    selectDropdown.innerHTML = '<option value="">Loading files...</option>';

    try {
        const bucketName = currentBucket; 
        
        if (!supabaseClient) {
            selectDropdown.innerHTML = '<option value="">Database not connected</option>';
            return;
        }
        
        const { data, error } = await supabaseClient
            .storage
            .from(bucketName)
            .list('', {
                limit: 100,
                sortBy: { column: 'name', order: 'asc' },
            });

        if (error) throw error;

        if (!data || data.length === 0) {
            selectDropdown.innerHTML = '<option value="">No files found in bucket</option>';
            return;
        }

        selectDropdown.innerHTML = '<option value="">-- Select a File --</option>';
        data.forEach(file => {
            if (file.name !== '.emptyFolderPlaceholder') {
                const option = document.createElement('option');
                option.value = file.name;
                option.textContent = file.name;
                selectDropdown.appendChild(option);
            }
        });

    } catch (error) {
        console.error('Error fetching from Supabase:', error);
        selectDropdown.innerHTML = '<option value="">Error loading files</option>';
    }
}

function selectCue(element) {
    // 1. Find every element with the class 'cue-box' and loop through them
    const allCues = document.querySelectorAll('.cue-box');
    allCues.forEach(cue => {
        // Remove the selected class from all of them, resetting them to regular
        cue.classList.remove('selected');
    });

    // 2. Add the 'selected' class ONLY to the one that was just clicked
    element.classList.add('selected');
}

fetchSupabaseFiles();
