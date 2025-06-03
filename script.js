let currentPage = 1;
const pages = document.querySelectorAll('.page');
const totalPages = pages.length;

function showPage(pageNumber) {
    for (let i = 0; i < pages.length; i++) {
        pages[i].classList.remove('active'); // Remove 'active' from all pages
    }
    pages[pageNumber - 1].classList.add('active'); // Activate the correct page
}


function nextPage() {
    if (currentPage < totalPages) {
        currentPage = currentPage + 1; // Move to the next page
    } else {
        currentPage = 1; // If on the last page, go back to Page 1
    }
    showPage(currentPage);
}

function prevPage() {
    if (currentPage > 1) {
        currentPage = currentPage - 1; // Move to the previous page
    } else {
        currentPage = totalPages; // If on the first page, go back to the last page
    }
    showPage(currentPage);
}

function getGreeting() {
    const now = new Date();
    const hour = now.getHours();
    let greeting;

    if (hour >= 5 && hour < 12) {
        greeting = "Good Morning";
    } else if (hour >= 12 && hour < 14) {
        greeting = "Good Noon";
    } else if (hour >= 14 && hour < 18) {
        greeting = "Good Afternoon";
    } else {
        greeting = "Good Evening";
    }

    return greeting;
}

document.addEventListener("DOMContentLoaded", function () {
    // Lazy load all images globally
    document.querySelectorAll("img:not(.no-lazy)").forEach(img => {
        if (!img.hasAttribute("loading")) {
            img.setAttribute("loading", "lazy");
        }
    });

    // Set greeting
    document.getElementById("greeting").textContent = getGreeting();

    // Handle hover and click to update `.currently`
    const navButtons = document.querySelectorAll('.navBarButton');
    let originalCurrently = document.querySelector('.navBarButton.currently');

    navButtons.forEach(button => {
        // Hover effect
        button.addEventListener('mouseenter', () => {
            navButtons.forEach(btn => btn.classList.remove('currently'));
            button.classList.add('currently');
        });

        button.addEventListener('mouseleave', () => {
            navButtons.forEach(btn => btn.classList.remove('currently'));
            if (originalCurrently) {
                originalCurrently.classList.add('currently');
            }
        });

        // Click to update selection
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('currently'));
            button.classList.add('currently');
            originalCurrently = button; // update reference
        });
    });

    // Keyboard navigation with transition lock
    let isTransitioning = false;

    document.addEventListener("keydown", function (event) {
        if (isTransitioning) return;
        isTransitioning = true;

        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextPage();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            prevPage();
        }

        setTimeout(() => {
            isTransitioning = false;
        }, 650); // Matches CSS transition time
    });
});