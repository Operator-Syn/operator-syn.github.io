let currentPage = 1;
const pages = document.querySelectorAll('.page');
const totalPages = pages.length;

function showPage(pageNumber) {
    pages.forEach(page => page.classList.remove('active'));
    pages[pageNumber - 1].classList.add('active');

    // Dynamic navBarButton update
    const navButtons = document.querySelectorAll('.navBarButton');
    navButtons.forEach(btn => btn.classList.remove('currently'));

    const activeButton = document.querySelector(`.navBarButton[data-page="${pageNumber}"]`);
    if (activeButton) {
        activeButton.classList.add('currently');
        originalCurrently = activeButton;
    }
}

function nextPage() {
    currentPage = currentPage < totalPages ? currentPage + 1 : 1;
    showPage(currentPage);
}

function prevPage() {
    currentPage = currentPage > 1 ? currentPage - 1 : totalPages;
    showPage(currentPage);
}

function getGreeting() {
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

        hour = hour % 12;
        if (hour === 0) hour = 12;

        const timeStr = `${String(hour).padStart(2, '0')}:${minute}:${second} ${ampm}`;
        const fullText = `${greeting} \u2192 ${timeStr} <br> &#x274F; Would you like to see my recent Github Activities?`;

        const greetingElem = document.getElementById("greeting");
        if (greetingElem) {
            greetingElem.innerHTML = fullText;
        }
    }

    updateGreetingWithTime();
    setInterval(updateGreetingWithTime, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
    const pages = Array.from(document.querySelectorAll('.page'));
    const navButtons = Array.from(document.querySelectorAll('.navBarButton'));
    const totalPages = pages.length;
    let currentPage = 1;
    let originalCurrently = document.querySelector('.navBarButton.currently');
    let isTransitioning = false;

    const dialogElement = document.getElementById('itemDialog');
    const dialogHeader = document.getElementById('dialogHeader');
    const dialogBody = document.getElementById('dialogBody');
    const dialogImage = document.getElementById('dialogImage');
    const dialogImageCaption = document.getElementById('dialogImageCaption');
    const closeButton = document.getElementById('closeBtn');
    const crossButton = document.getElementById('dialogCross');
    const profileEtc2 = document.getElementById("profileEtc2");
    const flipCards = document.querySelectorAll("#badges .flip-card");

    function showPage(pageNumber) {
        pages.forEach(p => p.classList.remove('active'));
        pages[pageNumber - 1].classList.add('active');

        navButtons.forEach(btn => btn.classList.remove('currently'));
        const activeButton = document.querySelector(`.navBarButton[data-page="${pageNumber}"]`);
        if (activeButton) {
            activeButton.classList.add('currently');
            originalCurrently = activeButton;
        }
    }

    function changePage(offset) {
        currentPage += offset;
        if (currentPage > totalPages) currentPage = 1;
        else if (currentPage < 1) currentPage = totalPages;
        showPage(currentPage);
    }

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
        const fullText = `${greeting} \u2192 ${timeStr} <br> &#x274F; Would you like to see my recent Github Activities?`;

        const greetingElem = document.getElementById("greeting");
        if (greetingElem) greetingElem.innerHTML = fullText;
    }

    setInterval(updateGreetingWithTime, 1000);
    updateGreetingWithTime();

    document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
        if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    });

    navButtons.forEach(button => {
        button.addEventListener('mouseenter', () => {
            navButtons.forEach(btn => btn.classList.remove('currently'));
            button.classList.add('currently');
        });

        button.addEventListener('mouseleave', () => {
            navButtons.forEach(btn => btn.classList.remove('currently'));
            if (originalCurrently) originalCurrently.classList.add('currently');
        });

        button.addEventListener('click', () => {
            const targetPage = parseInt(button.dataset.page);
            if (!isNaN(targetPage)) {
                currentPage = targetPage;
                showPage(currentPage);
            }
        });
    });

    document.addEventListener("keydown", event => {
        if (isTransitioning) return;
        isTransitioning = true;

        if (["ArrowRight", "ArrowDown"].includes(event.key)) changePage(1);
        else if (["ArrowLeft", "ArrowUp"].includes(event.key)) changePage(-1);

        setTimeout(() => { isTransitioning = false; }, 650);
    });

    if (profileEtc2) {
        profileEtc2.addEventListener("mouseenter", () => {
            flipCards.forEach(card => card.style.transform = "rotateY(180deg)");
        });
        profileEtc2.addEventListener("mouseleave", () => {
            flipCards.forEach(card => card.style.transform = "rotateY(0deg)");
        });
    }

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

    showPage(currentPage);
});