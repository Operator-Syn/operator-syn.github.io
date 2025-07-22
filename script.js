// Keeps track of the currently visible page
let currentPage = 1;

document.addEventListener("DOMContentLoaded", () => {
    // ====== PAGE NAVIGATION VARIABLES ======
    const pages = Array.from(document.querySelectorAll('.page')); // All page sections
    const navButtons = Array.from(document.querySelectorAll('.navBarButton')); // Navigation buttons
    const totalPages = pages.length; // Total number of pages
    let isTransitioning = false; // Prevents rapid navigation during transitions

    // ====== DIALOG ELEMENTS ======
    const dialogElement = document.getElementById('itemDialog');
    const dialogHeader = document.getElementById('dialogHeader');
    const dialogBody = document.getElementById('dialogBody');
    const dialogImage = document.getElementById('dialogImage');
    const dialogImageCaption = document.getElementById('dialogImageCaption');
    const closeButton = document.getElementById('closeBtn');
    const crossButton = document.getElementById('dialogCross');

    // ====== MOBILE MENU ELEMENTS ======
    const menuToggleButton = document.getElementById('menuToggleButton');
    const closeMenuToggleButton = document.getElementById('closeMenuToggleButton');
    const navLinksMobile = document.getElementById('navLinksMobile');

    // ====== MOBILE MENU TOGGLE ======
    if (menuToggleButton && navLinksMobile) {
        menuToggleButton.addEventListener('click', () => {
            navLinksMobile.classList.toggle('openMobileNav');
        });
    }

    if (closeMenuToggleButton && navLinksMobile) {
        closeMenuToggleButton.addEventListener('click', () => {
            navLinksMobile.classList.remove('openMobileNav');
        });
    }

    // ====== CLOSE MOBILE MENU ON OUTSIDE CLICK ======
    document.addEventListener('click', (event) => {
        const isClickInsideNav = navLinksMobile.contains(event.target);
        const isClickOnToggle = menuToggleButton.contains(event.target);

        if (navLinksMobile.classList.contains('openMobileNav') && !isClickInsideNav && !isClickOnToggle) {
            navLinksMobile.classList.remove('openMobileNav');
        }
    });



    // ====== PAGE NAVIGATION ======
    function showPage(pageNumber) {
        // Hide all pages, then show selected one
        pages.forEach(p => p.classList.remove('active'));
        pages[pageNumber - 1].classList.add('active');

        // Clear all highlights
        navButtons.forEach(btn => btn.classList.remove('currently'));

        // Highlight all matching buttons (desktop + mobile)
        const activeButtons = document.querySelectorAll(`.navBarButton[data-page="${pageNumber}"]`);
        activeButtons.forEach(btn => btn.classList.add('currently'));
    }

    function changePage(offset) {
        currentPage += offset;
        if (currentPage > totalPages) currentPage = 1;
        else if (currentPage < 1) currentPage = totalPages;
        showPage(currentPage);
    }

    // ====== GREETING & CLOCK UPDATE ======
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
        const fullText = `${greeting} \u2192 ${timeStr} <br> &#x274F; Take a look around — I hope you find something that inspires you.`;

        const greetingElem = document.getElementById("greeting");
        if (greetingElem) greetingElem.innerHTML = fullText;
    }

    setInterval(updateGreetingWithTime, 1000);
    updateGreetingWithTime();

    // ====== IMAGE OPTIMIZATION ======
    document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
        if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    });

    // ====== NAV BUTTON INTERACTIVITY ======
    function highlightPage(pageNumber) {
        navButtons.forEach(btn => btn.classList.remove('currently'));
        const matchingButtons = document.querySelectorAll(`.navBarButton[data-page="${pageNumber}"]`);
        matchingButtons.forEach(btn => btn.classList.add('currently'));
    }

    navButtons.forEach(button => {
        // Hover effect (temporary highlight)
        button.addEventListener('mouseenter', () => {
            highlightPage(button.dataset.page);
        });

        // Restore actual current page highlight after hover
        button.addEventListener('mouseleave', () => {
            highlightPage(currentPage);
        });

        // On click: switch page & keep highlight in both menus
        button.addEventListener('click', () => {
            const targetPage = parseInt(button.dataset.page);
            if (!isNaN(targetPage)) {
                currentPage = targetPage;
                showPage(currentPage);
                highlightPage(currentPage);

                // ✅ Close mobile menu after clicking a button
                if (navLinksMobile.classList.contains('openMobileNav')) {
                    navLinksMobile.classList.remove('openMobileNav');
                }
            }
        });

    });

    // ====== KEYBOARD NAVIGATION ======
    document.addEventListener("keydown", event => {
        if (isTransitioning) return;
        isTransitioning = true;

        if (["ArrowRight", "ArrowDown"].includes(event.key)) changePage(1);
        else if (["ArrowLeft", "ArrowUp"].includes(event.key)) changePage(-1);

        setTimeout(() => { isTransitioning = false; }, 650);
    });

    // ====== DIALOG HANDLING ======
    function openDialog() {
        dialogElement.showModal();
        requestAnimationFrame(() => {
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

    if (dialogElement) {
        dialogElement.addEventListener('cancel', e => {
            e.preventDefault();
            closeDialog();
        });
    }

    closeButton?.addEventListener('click', closeDialog);
    crossButton?.addEventListener('click', closeDialog);

    // ====== GRID ITEM CLICK HANDLING ======
    document.addEventListener('click', e => {
        const item = e.target.closest('.gridItem');
        if (!item) return;

        dialogHeader.innerHTML = item.dataset.title || '';
        dialogBody.innerHTML = item.dataset.content || '';
        dialogImage.innerHTML = item.dataset.image
            ? `<img src="${item.dataset.image}" alt="Dialog Image" style="max-width: 100%;">`
            : '';
        dialogImageCaption.innerHTML = item.dataset.caption || '';

        openDialog();
    });

    // Initialize by showing the first page & highlighting buttons
    showPage(currentPage);
    highlightPage(currentPage);
});
