const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
reveals.forEach((element) => observer.observe(element));

const form = document.querySelector('#waitlist-form');
const note = document.querySelector('#form-note');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = new FormData(form).get('email');
  if (!email) return;
  note.textContent = 'You are on the list. We will be in touch soon.';
  note.style.color = '#d7ff63';
  form.querySelector('button').innerHTML = 'You are in <span>✓</span>';
  form.querySelector('input').disabled = true;
});
