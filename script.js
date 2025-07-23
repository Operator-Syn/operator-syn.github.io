document.addEventListener("DOMContentLoaded", () => {
    const mainContainer = document.querySelector("main"); // We'll replace this when loading pages
    const navLinks = document.querySelectorAll("#navLinksDesktop a, #navLinksMobile a");
    const navLinksMobile = document.getElementById('navLinksMobile');

    // ====== PAGE CACHE FOR PRELOADING ======
    const pageCache = new Map();
    const pagesToPreload = ["projects.html", "certifications.html", "snippets.html"];

    // ====== SPA PAGE LOADING (with cache) ======
    async function loadPage(url, addToHistory = true) {
        try {
            // If page is already cached, use it directly
            if (pageCache.has(url)) {
                mainContainer.classList.add("fade-out");
                setTimeout(() => {
                    mainContainer.innerHTML = pageCache.get(url);
                    reinitializePageScripts();
                    mainContainer.classList.remove("fade-out");
                    if (addToHistory) history.pushState({ url }, "", url);
                    updateNavHighlight(url);
                }, 200);
                return;
            }

            // Otherwise fetch it normally (start fetching while fading out)
            const fetchPromise = fetch(url).then(res => res.text());
            mainContainer.classList.add("fade-out");

            const html = await fetchPromise;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const newMain = doc.querySelector("main");

            setTimeout(() => {
                if (newMain) {
                    mainContainer.innerHTML = newMain.innerHTML;
                    reinitializePageScripts();

                    // Cache the content for faster reloads
                    pageCache.set(url, newMain.innerHTML);
                }

                mainContainer.classList.remove("fade-out");

                if (addToHistory) {
                    history.pushState({ url }, "", url);
                }

                updateNavHighlight(url);
            }, 200);
        } catch (error) {
            console.error("Failed to load page:", error);
        }
    }

    // ====== UPDATE NAVBAR HIGHLIGHTS ======
    function updateNavHighlight(url) {
        navLinks.forEach(link => {
            link.querySelector("button")?.classList.remove("currently");
            if (link.getAttribute("href") === url) {
                link.querySelector("button")?.classList.add("currently");
            }
        });
    }

    // ====== START PRELOADING PAGES AFTER INITIAL LOAD ======
    setTimeout(() => {
        pagesToPreload.forEach(url => {
            if (!pageCache.has(url)) {
                fetch(url)
                    .then(res => res.text())
                    .then(html => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, "text/html");
                        const mainContent = doc.querySelector("main");
                        if (mainContent) {
                            pageCache.set(url, mainContent.innerHTML);
                        }
                    })
                    .catch(err => console.error("Preload failed for", url, err));
            }
        });
    }, 1000); // Wait 1 second after the site loads (avoid competing with first render)

    // Intercept all nav link clicks (desktop + mobile)
    navLinks.forEach(link => {
        link.addEventListener("click", e => {
            e.preventDefault();
            const url = link.getAttribute("href");
            loadPage(url);
            navLinksMobile?.classList.remove('openMobileNav'); // Close mobile menu
        });
    });

    // Handle browser back/forward navigation
    window.addEventListener("popstate", e => {
        if (e.state?.url) {
            loadPage(e.state.url, false);
        }
    });

    // ====== RE-INITIALIZE CONTENT AFTER PAGE LOAD ======
    function reinitializePageScripts() {
        const dialogElement = document.getElementById('itemDialog');
        const dialogHeader = document.getElementById('dialogHeader');
        const dialogBody = document.getElementById('dialogBody');
        const dialogImage = document.getElementById('dialogImage');
        const dialogImageCaption = document.getElementById('dialogImageCaption');
        const closeButton = document.getElementById('closeBtn');
        const crossButton = document.getElementById('dialogCross');

        function openDialog() {
            dialogElement.showModal();
            requestAnimationFrame(() => {
                dialogElement.scrollTop = 0;
                dialogBody.scrollTop = 0;
                dialogImageCaption.scrollTop = 0;
                dialogElement.classList.add('visible');
                document.body.classList.add('dialog-open');
            });
        }

        window.closeDialog = () => {
            dialogElement.classList.remove('visible');
            document.body.classList.remove('dialog-open');
            dialogElement.addEventListener('transitionend', () => {
                dialogElement.close();
            }, { once: true });
        };

        dialogElement?.addEventListener('cancel', e => {
            e.preventDefault();
            closeDialog();
        });

        closeButton?.addEventListener('click', closeDialog);
        crossButton?.addEventListener('click', closeDialog);

        // Grid items (dialog triggers)
        document.querySelectorAll('.gridItem').forEach(item => {
            item.addEventListener('click', () => {
                dialogHeader.innerHTML = item.dataset.title || '';
                dialogBody.innerHTML = item.dataset.content || '';
                dialogImage.innerHTML = item.dataset.image
                    ? `<img src="${item.dataset.image}" alt="Dialog Image" style="max-width: 100%;">`
                    : '';
                dialogImageCaption.innerHTML = item.dataset.caption || '';
                openDialog();
            });
        });

        // Lazy load images
        document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
            if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
        });

        updateGreetingWithTime();
    }

    // ====== CLOCK & GREETING ======
    function updateGreetingWithTime() {
        const now = new Date();
        let hour = now.getHours();
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        const ampm = hour >= 12 ? 'PM' : 'AM';

        let greeting;
        if (hour >= 5 && hour < 12) greeting = "Good Morning!";
        else if (hour >= 12 && hour < 14) greeting = "Good Noon";
        else if (hour >= 14 && hour < 18) greeting = "Good Afternoon!";
        else greeting = "Good Evening!";

        hour = hour % 12 || 12;
        const timeStr = `${String(hour).padStart(2, '0')}:${minute}:${second} ${ampm}`;
        const fullText = `${greeting} → ${timeStr} <br> ❏ Take a look around — I hope you find something that inspires you.`;

        const greetingElem = document.getElementById("greeting");
        if (greetingElem) greetingElem.innerHTML = fullText;
    }

    updateGreetingWithTime();
    setInterval(updateGreetingWithTime, 1000);

    // ====== MOBILE MENU TOGGLE ======
    const menuToggleButton = document.getElementById('menuToggleButton');
    const closeMenuToggleButton = document.getElementById('closeMenuToggleButton');

    if (menuToggleButton && navLinksMobile) {
        const toggleMenu = () => {
            requestAnimationFrame(() => {
                navLinksMobile.classList.toggle('openMobileNav');
            });
        };
        menuToggleButton.addEventListener('click', toggleMenu);
    }

    if (closeMenuToggleButton && navLinksMobile) {
        closeMenuToggleButton.addEventListener('click', () => {
            navLinksMobile.classList.remove('openMobileNav');
        });
    }

    document.addEventListener('click', (event) => {
        if (!navLinksMobile?.classList.contains('openMobileNav')) return;
        const isInside = navLinksMobile.contains(event.target) || menuToggleButton.contains(event.target);
        if (!isInside) navLinksMobile.classList.remove('openMobileNav');
    });

    // Initialize scripts for the first page load
    reinitializePageScripts();
});
