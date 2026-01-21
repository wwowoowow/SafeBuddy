
/* 1. 대중교통 경로 조회 */
export const fetchTransitRoute = async (sx, sy, ex, ey) => {
  try {
    const apiKey = process.env.REACT_APP_ODSAY_API_KEY; // API Key
    const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error("Failed to fetch transit route:", error);
    return null;
  }
};

/* 2. 동적 가중치 계산 */
export const getDynamicWeights = (userPref = {}) => {
  const { lightWeight = 1, cctvWeight = 1, blindWeight = 1 } = userPref;
  const hour = new Date().getHours();
  const isDaytime = hour >= 8 && hour <= 18;
  const timeFactor = isDaytime ? 0.1 : 2.5;

  return {
    light: lightWeight * timeFactor,
    cctv: cctvWeight * 1.5,
    blind: blindWeight * 1.2
  };
};

/* 3. 링크 비용 계산 (안전 점수 기반) */
export const calculateLinkCost = (linkProps, weights) => {
  const { 
    lamp_cnt = 0, cctv_cnt = 0, dark_score = 0, 
    blind_score = 0, length_m = 10 
  } = linkProps || {};

  const safetyScore = 
    (lamp_cnt * weights.light) + 
    (cctv_cnt * weights.cctv) - 
    (dark_score * weights.light * 10) - 
    (blind_score * weights.blind * 10);

  // 점수가 높을수록 Cost가 낮아짐 (최소 분모 0.1 보장)
  const cost = length_m / Math.max(safetyScore, 0.1); 
  return cost;
};

/* 4. ODsay 경로 파싱 */
export const parseOdsayPath = (polylineStr) => {
  if (!polylineStr) return [];
  return polylineStr.split(':').map((coord) => {
    const [lng, lat] = coord.split(',');
    return { lat: parseFloat(lat), lng: parseFloat(lng) };
  });
};

/* ============================================================
   [추가됨] 여기서부터 App.js가 찾고 있던 길찾기 알고리즘입니다.
   ============================================================ */

/**
 * 5. 그래프 생성 (GeoJSON 데이터를 그래프로 변환)
 * @param {Object} geoJsonData - 도로망 GeoJSON
 * @param {Object} weights - 계산된 가중치
 */
export const buildGraph = (geoJsonData, weights) => {
  const graph = {};

  if (!geoJsonData || !geoJsonData.features) return graph;

  geoJsonData.features.forEach((feature) => {
    const geometry = feature.geometry;
    const props = feature.properties;

    if (geometry.type === "LineString") {
      const coords = geometry.coordinates;
      // 링크의 비용 계산
      const cost = calculateLinkCost(props, weights);

      // 시작점과 끝점을 노드로, 선분을 간선(Edge)으로 등록
      const startNode = coords[0].join(","); // "127.123,37.123" 형태의 문자열 키
      const endNode = coords[coords.length - 1].join(",");

      if (!graph[startNode]) graph[startNode] = [];
      if (!graph[endNode]) graph[endNode] = [];

      // 양방향 도로라고 가정 (필요 시 일방통행 로직 추가 필요)
      graph[startNode].push({ node: endNode, cost, path: coords });
      graph[endNode].push({ node: startNode, cost, path: [...coords].reverse() });
    }
  });

  return graph;
};

/**
 * 6. 다익스트라(Dijkstra) 알고리즘을 이용한 안전 경로 탐색
 * @param {Object} graph - buildGraph로 만든 그래프
 * @param {Object} startCoords - {lat, lng} 출발지
 * @param {Object} endCoords - {lat, lng} 도착지
 */
export const findSafePath = (graph, startCoords, endCoords) => {
  // 좌표를 문자열 키로 변환 (반올림 등으로 매칭 확률 높여야 할 수 있음)
  // 현재는 단순 매칭으로 구현
  const findNearestNode = (lat, lng) => {
    let nearest = null;
    let minDist = Infinity;
    Object.keys(graph).forEach(key => {
      const [kLng, kLat] = key.split(',').map(Number);
      const dist = Math.sqrt(Math.pow(kLat - lat, 2) + Math.pow(kLng - lng, 2));
      if (dist < minDist) {
        minDist = dist;
        nearest = key;
      }
    });
    return nearest;
  };

  const startNode = findNearestNode(startCoords.lat, startCoords.lng);
  const endNode = findNearestNode(endCoords.lat, endCoords.lng);

  if (!startNode || !endNode) return null;

  // 다익스트라 초기화
  const times = {};
  const backtrace = {};
  const pq = []; // 우선순위 큐 (간단한 배열로 구현)

  times[startNode] = 0;
  
  Object.keys(graph).forEach(node => {
    if (node !== startNode) times[node] = Infinity;
  });

  pq.push({ node: startNode, time: 0 });

  while (pq.length > 0) {
    // 비용이 가장 낮은 노드 꺼내기
    pq.sort((a, b) => a.time - b.time);
    const shortestStep = pq.shift();
    const currentNode = shortestStep.node;

    if (currentNode === endNode) {
      // 경로 재구성 (Backtrace)
      const path = [];
      let lastStep = endNode;
      while(lastStep !== startNode) {
        path.unshift(lastStep);
        lastStep = backtrace[lastStep];
        if (!lastStep) break; 
      }
      path.unshift(startNode);

      // 좌표 배열로 변환하여 반환
      return path.map(nodeStr => {
        const [lng, lat] = nodeStr.split(',').map(Number);
        return { lat, lng };
      });
    }

    if (!graph[currentNode]) continue;

    graph[currentNode].forEach(neighbor => {
      const time = times[currentNode] + neighbor.cost;
      if (time < times[neighbor.node]) {
        times[neighbor.node] = time;
        backtrace[neighbor.node] = currentNode;
        pq.push({ node: neighbor.node, time: time });
      }
    });
  }

  return null; // 경로 없음
};