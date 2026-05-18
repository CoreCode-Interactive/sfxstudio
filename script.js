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
        // Initialize the Supabase SDK using the user's specific credentials
        supabaseClient = supabase.createClient(savedUrl, savedKey);
        currentBucket = savedBucket || "cue-media";
        
        if (configModal) configModal.style.display = 'none';
        console.log("Personal Supabase instance connected.");
    } else {
        if (configModal) configModal.style.display = 'flex';
    }
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
    const fileInput = document.getElementById('filePicker');
    
    if (fileInput.files.length === 0) return alert("Select a file first!");
    if (!supabaseClient) return alert("Connect your Supabase database first!");

    const file = fileInput.files[0];
    const addBtn = document.querySelector('.btn-add');
    
    try {
        addBtn.innerText = "Uploading...";
        addBtn.disabled = true;

        // Generate a simple timestamp file path
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;

        // 1. Upload raw binary file straight to user's bucket
        const { error: uploadError } = await supabaseClient.storage
            .from(currentBucket)
            .upload(fileName, file);

        if (uploadError) throw uploadError;

        // 2. Extract public streamable tracking link
        const { data: urlData } = supabaseClient.storage
            .from(currentBucket)
            .getPublicUrl(fileName);

        // 3. Register cue with small URL pointer instead of heavy Base64
        const newCue = {
            id: Date.now(),
            type: type,
            fileName: file.name,
            path: urlData.publicUrl, 
            needsLinking: false
        };

        cues.push(newCue);
        renderCues();
        fileInput.value = ""; 

    } catch (err) {
        console.error("Upload error details:", err);
        alert("Upload failed! Verify that your bucket name is typed accurately, your keys are correct, and your bucket settings are toggled to Public.\n\nError: " + err.message);
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

    cues.forEach(cue => {
        const div = document.createElement('div');
        div.className = "cue-box";
        div.onclick = () => fireCue(cue);
        div.innerHTML = `
            <div class="cue-info">
                <strong>${cue.type.toUpperCase()}</strong>: ${cue.fileName}
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
            renderCues();
        } catch (err) {
            alert("Invalid show file structural data.");
        }
    };
    reader.readAsText(file);
}
