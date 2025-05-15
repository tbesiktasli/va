function expandSlideIn(id) {
    const slideIns = document.querySelectorAll('.slide-in');
    slideIns.forEach((slideIn, index) => {
      if (slideIn.id === id) {
        
        slideIn.classList.add('expanded');
        slideIn.querySelector('.vertical-content').classList.add('visible');
        slideIn.querySelector('.close-btn').innerHTML = 'x';
      } else {
          slideIn.classList.remove('expanded'); 
          slideIn.querySelector('.close-btn').innerHTML = '&rarr;';
      }
    });
  }


function collapseSlideIn(id) {
  const slideIns = document.querySelectorAll('.slide-in');
  slideIns.forEach((slideIn) => {
    if (slideIn.id === id) {
      slideIn.classList.remove('expanded');
      slideIn.querySelector('.vertical-content').classList.remove('visible');
      slideIn.querySelector('.close-btn').innerHTML = '&larr;';
    } else {
      slideIn.querySelector('.close-btn').innerHTML = '&larr;';
    }
  });
}

/* fade in gallery box items when they move into view port */
const container = document.querySelector('.scroll-container-horizontal');
const titleBox = document.querySelector('.title-box');
const items = document.querySelectorAll('.gallery-box .item');

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, {
  root: container, // observe inside the scrollable div
  threshold: 0.1 // trigger when 10% of the item is visible
});

items.forEach(item => {
  observer.observe(item);
});
observer.observe(titleBox);


/* count yet unvisible gallery box items */
const countLeftEl = document.querySelector('.count-invisible-objects.left .value');
const countRightEl = document.querySelector('.count-invisible-objects.right .value');

function updateCounts() {
  const containerRect = container.getBoundingClientRect();

  let leftCount = 0;
  let rightCount = 0;

  items.forEach(item => {
    const itemRect = item.getBoundingClientRect();

    if (itemRect.right < containerRect.left) {
      // Completely left of view
      leftCount++;
    } else if (itemRect.left > containerRect.right) {
      // Completely right of view
      rightCount++;
    }
    // Else, it's visible — do nothing
  });

  countLeftEl.textContent = leftCount;
  countRightEl.textContent = rightCount;
}

// Update on scroll and resize
container.addEventListener('scroll', updateCounts);
window.addEventListener('resize', updateCounts);

// Initial check
updateCounts();


function showSlideIns() {
  const slideIns = document.getElementById('slide-ins');
  slideIns.classList.add('visible');
}

showSlideIns();


document.getElementById('scroll-on').onclick = (e) => {
  e.preventDefault();
  document.querySelector('.gallery-box').scrollIntoView({ behavior: 'smooth', inline: 'start' });
}


/*
sections.forEach((section, index) => {
  const right = section.querySelector('.right');
  if(!right) return;
  let scrollDirection = null;

  // Track scroll direction
  right.addEventListener('wheel', function (event) {
    scrollDirection = event.deltaY > 0 ? 'down' : 'up';
  }, { passive: true });

  // Scroll to next or previous section based on .right scroll position
  right.addEventListener('scroll', function () {
    console.log(right.scrollTop, right.clientHeight, right.scrollTop + right.clientHeight, right.scrollHeight);
    const atBottom = right.scrollTop + right.clientHeight >= right.scrollHeight - 2;
    const atTop = right.scrollTop <= 2;

    if (scrollDirection === 'down' && atBottom && !section.classList.contains('scrolled-down')) {
      section.classList.add('scrolled-down');
      const nextSection = sections[index + 1];
      if (nextSection) {
        nextSection.scrollIntoView({ behavior: 'smooth' });
      }
    }

    if (scrollDirection === 'up' && atTop && !section.classList.contains('scrolled-up')) {
      section.classList.add('scrolled-up');
      const prevSection = sections[index - 1];
      if (prevSection) {
        prevSection.scrollIntoView({ behavior: 'smooth' });
      }
    }

    // Reset flags
    if (!atBottom) section.classList.remove('scrolled-down');
    if (!atTop) section.classList.remove('scrolled-up');
  });
});
*/

/*
const containers = document.querySelectorAll('.vertical-content');

containers.forEach(container => {
  const sections = container.querySelectorAll('.content-section');

  let isScrolling = false; // lock flag

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !isScrolling) {
        isScrolling = true;

        container.scrollTo({
          top: entry.target.offsetTop - container.offsetTop,
          behavior: 'smooth',
        });

        // Release the lock after the scroll is likely done (adjust if needed)
        setTimeout(() => {
          isScrolling = false;
        }, 700); // 500ms is usually enough for smooth scroll
      }
    });
  }, {
    root: container,
    threshold: 0.01,
  });

  sections.forEach(section => observer.observe(section));
});
*/

const horizontal = document.querySelector('.scroll-container-horizontal');
const vertical = document.querySelector('.scroll-container-vertical');

function fadeOut(container) {
  container.style.opacity = '0';
  setTimeout(() => {
    container.style.display = 'none';
  }, 400); // matches transition duration
}

function fadeIn(container) {
  container.style.display = 'block';
  requestAnimationFrame(() => {
    container.style.opacity = '1';
  });
}

function showHorizontal() {
  fadeOut(vertical);
  fadeIn(horizontal);
}

function showVertical() {
  fadeOut(horizontal);
  fadeIn(vertical);
}



/*
let currentScroll = 0;
let targetScroll = 0;
const scrollContainer = document.querySelector('.scroll-container-horizontal');

scrollContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  targetScroll += e.deltaX; // or deltaX for horizontal
});

function smoothScroll() {
  currentScroll += (targetScroll - currentScroll) * 0.1; // 0.1 is easing factor
  scrollContainer.scrollLeft = currentScroll;
  requestAnimationFrame(smoothScroll);
}

smoothScroll();
*/

/*
const scrollWrapper = document.querySelector('.scroll-container-horizontal');

const scrollbar = Scrollbar.init(scrollWrapper, {
  damping: 0.1,          // how much smoothing (0 = sharp, 1 = super slow)
  renderByPixels: true,  // better performance
  alwaysShowTracks: true, // optional: always show scroll tracks
  continuousScrolling: true,
  plugins: {
    overscroll: {
      effect: 'bounce',           // or 'glow'
      damping: 0.15,              // how bouncy (lower = softer, higher = tighter)
      maxOverscroll: 200          // max distance you can pull
    }
  }
});
*/

/*
const scroll = new LocomotiveScroll({
  el: document.querySelector('.scroll-container'),
  smooth: true,
  direction: 'horizontal', // 👈 Enable horizontal scrolling!
  multiplier: 0.1,          // 👈 Speed of the scroll
  lerp: 0.1,                // 👈 Easing factor (0 = no easing, 1 = instant)
});
*/