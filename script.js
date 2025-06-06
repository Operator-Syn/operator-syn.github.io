let currentPage = 1;
const pages = document.querySelectorAll('.page');
const totalPages = pages.length;

function showPage(pageNumber) {
    for (let i = 0; i < pages.length; i++) {
        pages[i].classList.remove('active');
    }
    pages[pageNumber - 1].classList.add('active');
}

function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
    } else {
        currentPage = 1;
    }
    showPage(currentPage);
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
    } else {
        currentPage = totalPages;
    }
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

document.addEventListener("DOMContentLoaded", function () {
    let currentPage = 1;
    const pages = document.querySelectorAll('.page');
    const totalPages = pages.length;

    function showPage(pageNumber) {
        pages.forEach(page => page.classList.remove('active'));
        pages[pageNumber - 1].classList.add('active');
    }

    function nextPage() {
        currentPage = currentPage < totalPages ? currentPage + 1 : 1;
        showPage(currentPage);
    }

    function prevPage() {
        currentPage = currentPage > 1 ? currentPage - 1 : totalPages;
        showPage(currentPage);
    }

    getGreeting();

    document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
        if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    });

    const navButtons = document.querySelectorAll('.navBarButton');
    let originalCurrently = document.querySelector('.navBarButton.currently');

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
            navButtons.forEach(btn => btn.classList.remove('currently'));
            button.classList.add('currently');
            originalCurrently = button;
        });
    });

    let isTransitioning = false;
    document.addEventListener("keydown", function (event) {
        if (isTransitioning) return;
        isTransitioning = true;

        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextPage();
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") prevPage();

        setTimeout(() => {
            isTransitioning = false;
        }, 650);
    });

    const profileEtc2 = document.getElementById("profileEtc2");
    const flipCards = document.querySelectorAll("#badges .flip-card");

    if (profileEtc2) {
        profileEtc2.addEventListener("mouseenter", () => {
            flipCards.forEach(card => card.style.transform = "rotateY(180deg)");
        });

        profileEtc2.addEventListener("mouseleave", () => {
            flipCards.forEach(card => card.style.transform = "rotateY(0deg)");
        });
    }

    const projectsButton = document.getElementById('projectsButton');
    const homeButton = document.getElementById('homeButton');

    if (projectsButton) {
        projectsButton.addEventListener('click', () => {
            currentPage = 2;
            showPage(currentPage);
        });
    }

    if (homeButton) {
        homeButton.addEventListener('click', () => {
            currentPage = 1;
            showPage(currentPage);
        });
    }

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
            dialogElement.classList.add('visible');
            document.body.classList.add('dialog-open'); // 👈 add this
        });
    }

    // Make closeDialog globally accessible
    window.closeDialog = function () {
        dialogElement.classList.remove('visible');
        document.body.classList.remove('dialog-open'); // 👈 remove this
        dialogElement.addEventListener('transitionend', () => {
            dialogElement.close();
        }, { once: true });
    };



    // ⬇️ Fix for Esc key transition
    if (dialogElement) {
        dialogElement.addEventListener('cancel', function (event) {
            event.preventDefault(); // Prevent instant close
            closeDialog();          // Use smooth transition
        });
    }

    if (closeButton) closeButton.addEventListener('click', closeDialog);
    if (crossButton) crossButton.addEventListener('click', closeDialog);

    document.querySelectorAll('.gridItem').forEach(item => {
        item.addEventListener('click', () => {
            dialogHeader.innerHTML = item.dataset.title || '';
            dialogBody.innerHTML = item.dataset.content || '';

            if (item.dataset.image) {
                dialogImage.innerHTML = `<img src="${item.dataset.image}" alt="Dialog Image" style="max-width: 100%;">`;
            } else {
                dialogImage.innerHTML = '';
            }

            dialogImageCaption.innerHTML = item.dataset.caption || '';
            openDialog();
        });
    });

    showPage(currentPage);
});
