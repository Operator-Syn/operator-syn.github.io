// Track the current visible page
let currentPage = 1;

document.addEventListener("DOMContentLoaded", () => {
    // ====== PAGE NAVIGATION ELEMENTS ======
    const pages = Array.from(document.querySelectorAll('.page'));
    const navButtons = Array.from(document.querySelectorAll('.navBarButton'));
    const totalPages = pages.length;
    let isTransitioning = false;

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

    // ====== TOGGLE MOBILE MENU (GPU-friendly) ======
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

    // Close menu when clicking outside
    document.addEventListener('click', (event) => {
        if (!navLinksMobile?.classList.contains('openMobileNav')) return;
        const isInside = navLinksMobile.contains(event.target) || menuToggleButton.contains(event.target);
        if (!isInside) navLinksMobile.classList.remove('openMobileNav');
    });

    // ====== PAGE NAVIGATION ======
    function showPage(pageNumber) {
        // Update visible page
        pages.forEach((p, i) => p.classList.toggle('active', i === pageNumber - 1));

        // Update nav highlights (desktop + mobile)
        navButtons.forEach(btn => {
            btn.classList.toggle('currently', btn.dataset.page == pageNumber);
        });
    }

    function changePage(offset) {
        currentPage += offset;
        if (currentPage > totalPages) currentPage = 1;
        else if (currentPage < 1) currentPage = totalPages;
        showPage(currentPage);
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
        const fullText = `${greeting} \u2192 ${timeStr} <br> &#x274F; Take a look around — I hope you find something that inspires you.`;

        const greetingElem = document.getElementById("greeting");
        if (greetingElem) greetingElem.innerHTML = fullText;
    }

    setInterval(updateGreetingWithTime, 1000);
    updateGreetingWithTime();

    // ====== IMAGE LAZY LOADING ======
    document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
        if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    });

    // ====== NAV BUTTON INTERACTIVITY ======
    navButtons.forEach(button => {
        const pageNum = parseInt(button.dataset.page);
        if (isNaN(pageNum)) return;

        // Hover highlight
        button.addEventListener('mouseenter', () => {
            navButtons.forEach(btn => btn.classList.toggle('currently', btn.dataset.page == pageNum));
        });

        button.addEventListener('mouseleave', () => {
            navButtons.forEach(btn => btn.classList.toggle('currently', btn.dataset.page == currentPage));
        });

        // Click to navigate
        button.addEventListener('click', () => {
            currentPage = pageNum;
            showPage(currentPage);
            navLinksMobile?.classList.remove('openMobileNav'); // Auto-close on mobile
        });
    });

    // ====== KEYBOARD NAVIGATION ======
    document.addEventListener("keydown", event => {
        if (isTransitioning) return;
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;

        isTransitioning = true;
        changePage(["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1);
        setTimeout(() => { isTransitioning = false; }, 650);
    });

    // ====== DIALOG HANDLING ======
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

    // ====== GRID ITEM CLICK HANDLING ======
    document.addEventListener('click', e => {
        const item = e.target.closest('.gridItem');
        if (!item) return;

        dialogHeader.innerHTML = item.dataset.title || '';  // Restore HTML
        dialogBody.innerHTML = item.dataset.content || '';
        dialogImage.innerHTML = item.dataset.image
            ? `<img src="${item.dataset.image}" alt="Dialog Image" style="max-width: 100%;">`
            : '';
        dialogImageCaption.innerHTML = item.dataset.caption || '';  // Restore HTML

        openDialog();
    });

    // Initialize first page
    showPage(currentPage);
});