// 1. 초기 민원 데이터
export const initialComplaints = [
  { id: 1, type: 'complaint', lat: 37.4981, lng: 127.0277, title: "가로등 고장", address: "서울 강남구 역삼동 825-1", date: "2023.10.01", reason: "저녁에 너무 어두워서 발을 헛디딜 뻔했습니다.", likes: 12, dislikes: 0, rating: 3 },
  { id: 2, type: 'complaint', lat: 37.4982, lng: 127.0278, address: "서울 강남구 테헤란로 110", date: "2023.10.05", reason: "비 오면 물웅덩이가 생겨서 걷기 불편해요.", likes: 5, dislikes: 1, rating: 2 },
  { id: 3, type: 'complaint', lat: 37.4983, lng: 127.0279, address: "서울 강남구 역삼동 823", date: "2023.10.11", reason: "전봇대 아래 냄새가 너무 심합니다.", likes: 8, dislikes: 2, rating: 1 },
];

// 2. 경찰서 및 안전 시설 데이터
export const policeData = [
  { type: 'police', lat: 37.4999, lng: 127.0280, title: "역삼지구대", address: "서울 강남구 역삼동 827-24", hours: "24시간 운영", reason: "가장 가까운 치안 거점입니다." },
  { type: 'guardian', lat: 37.4970, lng: 127.0260, title: "안전지킴이집 1", address: "서울 강남구 역삼동 편의점", hours: "21:00 ~ 02:00", reason: "여성/아동 안심 귀가 보호소입니다." },
];

// 3. 사용자 기본 선호도 설정
export const defaultUserPrefs = {
  cctv: 3,  // 1~5 (높을수록 CCTV 선호)
  blind: 3  // 1~5 (높을수록 사각지대 회피)
};