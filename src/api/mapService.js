import dijkstra from 'dijkstrajs'; 

const ODSAY_API_KEY = process.env.REACT_APP_ODSAY_API_KEY;

// =========================================================
// 1. 그래프 생성 (단순 구조만 생성, 비용 계산은 나중에)
// =========================================================
export const buildGraph = (geoData) => {
  const graph = {}; 
  const features = Array.isArray(geoData) ? geoData : (geoData.features || []);

  features.forEach(feature => {
    const props = feature.properties;

    // 노드 ID (좌표 대신 ID 사용 -> 훨씬 빠르고 정확함)
    const u = props.F_NODE ? String(props.F_NODE) : `n_${props.link_id}_s`; 
    const v = props.T_NODE ? String(props.T_NODE) : `n_${props.link_id}_e`;
    
    // 데이터 추출
    const len = props.LENGTH || 100;
    const width = props.width || props.road_width || 6;
    const cctv = props.cctv_cnt || 0;
    const lamp = props.lamp_cnt || 0;

    // 📝 [단순 규칙] 사각지대 점수 미리 계산
    let blindScore = 0;
    if (cctv === 0) blindScore += 20;   // CCTV 없으면 위험
    if (lamp === 0) blindScore += 10;   // 가로등 없으면 위험
    if (width < 4) blindScore += 20;    // 좁으면 위험
    if (width >= 12) blindScore = 0;    // 큰 길은 안전

    const edgeData = {
      id: props.link_id,
      len: len,
      cctv: cctv,
      lamp: lamp,
      width: width,
      blind: props.blind_score || blindScore, 
      geometry: feature.geometry.coordinates 
    };

    if (!graph[u]) graph[u] = {};
    if (!graph[v]) graph[v] = {};

    graph[u][v] = edgeData;
    graph[v][u] = edgeData; 
  });

  return graph;
};

// =========================================================
// 2. 길찾기 (여기서 가중치를 동적으로 적용!)
// =========================================================
export const findSafePath = (startStr, endStr, graph, weights) => {
  if (!graph) return [];

  const nodes = Object.keys(graph);
  if (nodes.length === 0) return [];

  // *데모용: 실제로는 startStr(좌표)와 가장 가까운 노드를 찾아야 함
  // 지금은 그래프 연결 테스트를 위해 임의의 노드 사용
  const startNode = nodes[0]; 
  const endNode = nodes[Math.floor(nodes.length / 2)]; 

  // 비용 계산 함수 (핵심!)
  const getCost = (u, v) => {
    const edge = graph[u][v];
    if (!edge) return 999999;

    let cost = edge.len; 
    
    // weights 값에 따라 안심/최단 경로가 결정됨
    cost -= (edge.cctv * weights.cctv * 5); 
    cost -= (edge.lamp * weights.light * 2); 
    cost += (edge.blind * weights.blind * 10); 

    return Math.max(1, cost); 
  };

  try {
    // 라이브러리 사용을 위한 그래프 변환
    const costGraph = {};
    for (const u in graph) {
      costGraph[u] = {};
      for (const v in graph[u]) {
        costGraph[u][v] = getCost(u, v);
      }
    }

    // 🚀 라이브러리로 최단 경로 찾기
    const pathNodes = dijkstra.find_path(costGraph, startNode, endNode);
    
    // 좌표 변환
    const pathCoords = [];
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const u = pathNodes[i];
      const v = pathNodes[i+1];
      const edge = graph[u][v];
      if (edge && edge.geometry) {
        edge.geometry.forEach(pt => pathCoords.push({ lat: pt[1], lng: pt[0] }));
      }
    }
    return pathCoords;
  } catch (e) {
    console.error("경로 찾기 실패:", e);
    return [];
  }
};

// =========================================================
// 3. ODsay API
// =========================================================
export const fetchTransitRoute = async (sx, sy, ex, ey) => {
  try {
    // API 키 없어도 테스트 가능하게 처리
    const apiKey = process.env.REACT_APP_ODSAY_API_KEY;
    if (!apiKey) throw new Error("API Key 없음");

    const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.result) return data.result;
    else throw new Error("결과 없음");
  } catch (error) {
    console.warn("ODsay 에러 (더미 경로 반환):", error);
    return {
      path: [{
        pathType: 1,
        info: { totalTime: 15, totalDistance: 500, payment: 0 },
        subPath: [
          { trafficType: 3, sectionTime: 15, startX: sx, startY: sy, endX: ex, endY: ey }
        ]
      }]
    };
  }
};