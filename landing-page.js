document.addEventListener("DOMContentLoaded", () => {
    const introPlayed = sessionStorage.getItem("introPlayed");
    const welcomeText = document.getElementById("welcome-text");
    const subheading = document.querySelector(".subheadingDiv h2");

    const fileNames = {
        "current projects": "current-projects.html",
        "completed work": "completed-work.html",
        "resume": "resume.html",
        "blog & about me": "blog.html"
    };

    if (introPlayed) {
        // If the user has already visited in this session, render immediately without animations
        if (subheading) {
            const rawText = subheading.textContent.toLowerCase();
            const sections = rawText.split("|");
            subheading.innerHTML = "";

            sections.forEach((section, index) => {
                const trimmed = section.trim();

                if (index > 0) {
                    const separator = document.createElement("span");
                    separator.textContent = " | ";
                    separator.className = "separator";
                    subheading.appendChild(separator);
                }

                const a = document.createElement("a");
                a.textContent = trimmed;
                a.href = fileNames[trimmed.replace(/\s+/g, " ")] || "#";
                subheading.appendChild(a);
            });
        }
        return;
    }

    // First visit in this session: play animations and mark the session as visited
    sessionStorage.setItem("introPlayed", "true");

    let totalWelcomeDelay = 0;
    
    if (welcomeText) {
        const text = welcomeText.textContent;
        welcomeText.innerHTML = ""; // Clear existing text

        let delay = 0;
        // Iterate over each character
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (char === " ") {
                // preserve spaces
                welcomeText.appendChild(document.createTextNode(" "));
            } else {
                const span = document.createElement("span");
                span.textContent = char;
                span.className = "fade-letter";
                span.style.animationDelay = `${delay}s`;
                welcomeText.appendChild(span);
                delay += 0.15; // Increment delay for next letter
            }
        }
        totalWelcomeDelay = delay;
    }

    if (subheading) {
        const rawText = subheading.textContent.toLowerCase();
        const sections = rawText.split("|");
        subheading.innerHTML = "";

        let sectionDelay = totalWelcomeDelay + 0.5; // Start after welcome text + small pause
        
        sections.forEach((section, index) => {
            const trimmed = section.trim();

            if (index > 0) {
                const separator = document.createElement("span");
                separator.textContent = " | ";
                separator.className = "fade-section";
                separator.style.animationDelay = `${sectionDelay}s`;
                subheading.appendChild(separator);
            }

            const a = document.createElement("a");
            a.textContent = trimmed;
            a.href = fileNames[trimmed.replace(/\s+/g, " ")] || "#";
            a.className = "fade-section";
            a.style.animationDelay = `${sectionDelay}s`;
            
            subheading.appendChild(a);
            
            sectionDelay += 0.3; // Stagger sections
        });
    }
});
