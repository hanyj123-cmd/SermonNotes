// 화면에 "null" 같은 글자가 찍히지 않게: replaceChildren · append · prepend 에 빈 값(null·undefined·false)이 오면 건너뜁니다.
// (예: 정답일 때 "정답: …" 줄 자리에 null 을 넘기면 브라우저가 글자 "null" 로 보여 주던 문제)
(function () {
  const skip = (k) => k != null && k !== false;
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach((proto) => {
    ['replaceChildren', 'append', 'prepend'].forEach((name) => {
      const orig = proto[name];
      if (typeof orig !== 'function' || orig.__noNull) return;
      const wrapped = function (...kids) {
        return orig.apply(this, kids.filter(skip));
      };
      wrapped.__noNull = true;
      proto[name] = wrapped;
    });
  });
})();

// 앱 설정 값. 둘 다 비밀이 아닌 공개 값입니다 (비밀번호·키는 여기에 쓰지 마세요).
window.APP_CONFIG = {
  // Apps Script 웹앱 주소 (재생목록 관리 + 개인 노트 저장에 사용)
  ADMIN_API_URL: 'https://script.google.com/macros/s/AKfycbycWp5vn8jlIojuCG9cMjlOtJyppTN9Djd2nGDAjmCC06MZrd-RhzPGtNDugW1Z5n2d/exec',

  // 구글 로그인용 OAuth 클라이언트 ID (개인 노트 기능에 필요)
  GOOGLE_CLIENT_ID: '896403793535-72hj7vkl6h1e80fd8stug1cv9lb1po67.apps.googleusercontent.com',

  // 핸드아웃(PDF) 맨 끝에 들어가는 만든 사람 표시. 바꾸거나 지우려면 이 줄만 고치세요.
  CREDIT: 'Made by 한윤종 (Patrick Han)',
};
