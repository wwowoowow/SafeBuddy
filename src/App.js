import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Map, MapMarker, CustomOverlayMap, Polyline, useKakaoLoader } from "react-kakao-maps-sdk";
import useSupercluster from "use-supercluster";
import { Search, Shield, Map as MapIcon, Layers, ArrowRightLeft, X, Navigation, AlertCircle, MapPin, ThumbsUp, ThumbsDown, XCircle, Crosshair, FileText, Menu, Camera, ChevronRight, User, Bell, Settings, LogOut, ShieldCheck, PhoneCall, ExternalLink, Star, Clock, Heart, Zap } from "lucide-react";
import { policeData, defaultUserPrefs } from "./data/mockData";
import { fetchTransitRoute, buildGraph, findSafePath } from "./api/mapService";
import { useComplaints } from "./hooks/useComplaints";
import { GU_CENTERS } from "./data/guData";

export default function App() {
  const [loading, error] = useKakaoLoader({ 
    appkey: process.env.REACT_APP_KAKAO_API_KEY,
    libraries: ["services", "clusterer"],
  });

  const loadSummaryData = () => {
    fetch('/summary_by_gu.csv')
      .then(res => res.text()) // CSV는 json()이 아니라 text()로 읽습니다.
      .then(text => {
        // 줄바꿈(\n)으로 쪼개서 배열로 만들기
        const lines = text.split('\n');
        
        // 첫 줄(헤더) 빼고 데이터만 출력해보기
        lines.slice(1).forEach(line => {
          const [gu, count] = line.split(',');
          if (gu && count) {
            console.log(`${gu}의 도로 개수: ${count}개`);
          }
        });
      });
  };

  const [myPos, setMyPos] = useState({ lat: 37.498095, lng: 127.027610 });
  const [isGpsLoading, setIsGpsLoading] = useState(true);
  const mapRef = useRef();
  const [activeTab, setActiveTab] = useState("home");

  const [showRoute, setShowRoute] = useState(true);
  const [showComplaints, setShowComplaints] = useState(true);
  const [showSafety, setShowSafety] = useState(true);
  const [isDirectionMode, setIsDirectionMode] = useState(false);
  const [routeType, setRouteType] = useState("safe");
  const [graph, setGraph] = useState(null);
  const [transitData, setTransitData] = useState(null);
  const [geoData, setGeoData] = useState([]);

  // 사용자의 안전 선호도 
  const [userPrefs, setUserPrefs] = useState(defaultUserPrefs);
  
  const [keyword, setKeyword] = useState(""); 
  const [searchPlaces, setSearchPlaces] = useState([]);
  const [mapCenter, setMapCenter] = useState(myPos); 
  const [selectedInfo, setSelectedInfo] = useState(null);

  const [startPoint, setStartPoint] = useState("");
  const [endPoint, setEndPoint] = useState("");

  const [zoom, setZoom] = useState(20 - 3); 
  const [bounds, setBounds] = useState(null);

  const { 
    complaints, myComplaints, userReactions, 
    addComplaint, deleteComplaint, handleReaction 
  } = useComplaints();
  
  const [compTitle, setCompTitle] = useState("");
  const [compContent, setCompContent] = useState("");
  const [compRating, setCompRating] = useState(5);
  const [compLocation, setCompLocation] = useState({ lat: myPos.lat, lng: myPos.lng, address: "📍 현재 위치" });
  const [isPickingLocation, setIsPickingLocation] = useState(false);

  // 안전도에 따른 색상 반환 함수
  const getSafetyColor = (level) => {
    if (level === "high") return "#10b981";   // 초록
    if (level === "medium") return "#f59e0b"; // 주황
    if (level === "low") return "#ef4444";    // 빨강
    return "#3b82f6";
  };

    const getDynamicWeights = useCallback(() => {
    const hour = new Date().getHours();
    // 낮(08~18시)에는 밝기 가중치를 0.2배로 낮추고, 밤에는 2.5배로 강화
    const isDay = hour >= 8 && hour <= 18;
    const timeFactor = isDay ? 0.2 : 2.5;

    return {
      light: 3 * timeFactor,
      cctv: userPrefs.cctv * 1.5,
      blind: userPrefs.blind * 2.0
    };
  }, [userPrefs]);

  const visibleRoads = useMemo(() => {
    if (zoom < 15) return [];
    // 데이터가 없으면 안 그림
    if (!bounds || geoData.length === 0 ) return [];
    
    const [swLng, swLat, neLng, neLat] = bounds;
    const weights = getDynamicWeights();

    return geoData.map(feature => {
      const props = feature.properties;
      
      // 1. 안전 데이터가 있는지 확인
      const hasSafetyInfo = props.cctv_cnt !== undefined || props.lamp_cnt !== undefined;
      
      let dynamicLevel = "unknown"; // 기본값 (데이터 없음)

      // 2. 안전 데이터가 있을 때만 점수 계산
      if (hasSafetyInfo) {
        const safetyScore = 
          (props.lamp_cnt || 0) * weights.light + 
          (props.cctv_cnt || 0) * weights.cctv - 
          (props.dark_score || 0) * weights.light * 5 - 
          (props.blind_score || 0) * weights.blind * 5;

        if (safetyScore > 15) dynamicLevel = "high";
        else if (safetyScore > 5) dynamicLevel = "medium";
        else dynamicLevel = "low";
      }

      // 3. 좌표 변환
      const kakaoPath = feature.geometry.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));

      return {
        id: props.link_id || Math.random(), // ID 없으면 임시로 생성
        safety: dynamicLevel,
        path: kakaoPath
      };
    }).filter(road => {
      // 4. 화면 안에 있는 도로만 표시 (필터링 로직 단순화)
      return road.path.some(pt => 
        pt.lat >= swLat && pt.lat <= neLat && pt.lng >= swLng && pt.lng <= neLng
      );
    });
  }, [bounds, geoData, getDynamicWeights, zoom]);

  const [loadedGus, setLoadedGus] = useState([]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
          const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMyPos(newPos); setMapCenter(newPos);
          setCompLocation({ ...newPos, address: "📍 현재 위치" });
          setIsGpsLoading(false);
        }, () => setIsGpsLoading(false), { enableHighAccuracy: true }
      );
    }
  }, []);

  // =========================================================
  // ✨ 스마트 데이터 로딩 시스템 (주변 구 자동 로딩)
  // =========================================================
  
  // 1. 내 위치 주변의 데이터를 찾아서 로딩하는 함수
  const loadNearbyData = useCallback(async (centerLat, centerLng) => {
    // 1. 거리 계산
    const nearbyGus = GU_CENTERS.map(gu => {
      const dist = Math.sqrt(Math.pow(gu.lat - centerLat, 2) + Math.pow(gu.lng - centerLng, 2));
      return { ...gu, dist };
    }).sort((a, b) => a.dist - b.dist).slice(0, 3);

    // 2. 로딩할 구 선별
    const newGusToLoad = nearbyGus.filter(gu => !loadedGus.includes(gu.name));
    if (newGusToLoad.length === 0) return;

    console.log(`📡 [1단계] 로딩 시도: ${newGusToLoad.map(g => g.name).join(", ")}`);

    // 3. 파일 Fetch 시도 (상세 로그 추가)
    const promises = newGusToLoad.map(async (gu) => {
      // 경로 확인: public/links_geojson/links_강남구.geojson
      const path = `/links_geojson/links_${gu.name}.geojson`; 
      console.log(`🔍 [2단계] 파일 요청: ${path}`);
      
      try {
        const res = await fetch(path);
        
        // 🚨 여기가 중요! 404나 에러가 나면 여기서 잡힘
        if (!res.ok) {
          console.error(`❌ [실패] 파일을 찾을 수 없음 (${res.status}): ${path}`);
          return null;
        }

        const json = await res.json();
        console.log(`📦 [성공] ${gu.name} 데이터 다운로드 완료 (${json.features?.length}개)`);
        return { name: gu.name, features: json.features };

      } catch (err) {
        console.error(`💥 [에러] 데이터 파싱 실패 (${gu.name}):`, err);
        return null;
      }
    });

    const results = await Promise.all(promises);
    
    // 4. 유효한 데이터만 합치기
    const validResults = results.filter(r => r !== null);
    
    if (validResults.length > 0) {
      const newFeatures = validResults.flatMap(r => r.features);
      const newGuNames = validResults.map(r => r.name);

      setGeoData(prev => {
        const merged = [...prev, ...newFeatures];
        console.log(`✅ [3단계] 최종 병합 완료! 총 도로 수: ${merged.length}`);
        
        // 그래프 재생성
        const newGraph = buildGraph({ features: merged });
        setGraph(newGraph);
        return merged;
      });

      setLoadedGus(prev => [...prev, ...newGuNames]);
    } else {
      console.warn("⚠️ [경고] 로딩을 시도했으나 유효한 데이터가 하나도 없습니다.");
    }

  }, [loadedGus]);

  // 2. 앱 시작 시 & 지도가 멈출 때마다 데이터 체크
  // (updateMapBounds 함수 안에서 호출해도 되고, useEffect로 center를 감시해도 됨)
  useEffect(() => {
    // 지도가 움직임이 멈추거나 초기화되면 주변 데이터 로딩
    if (!isGpsLoading) {
      loadNearbyData(mapCenter.lat, mapCenter.lng);
    }
  }, [mapCenter, isGpsLoading, loadNearbyData]);

  const onMapCreated = useCallback((map) => {
    setTimeout(() => { map.relayout(); map.setCenter(new window.kakao.maps.LatLng(mapCenter.lat, mapCenter.lng)); }, 100);
  }, [mapCenter.lat, mapCenter.lng]);

  const points = useMemo(() => complaints.map(c => ({
    type: "Feature", properties: { cluster: false, complaintId: c.id, ...c },
    geometry: { type: "Point", coordinates: [c.lng, c.lat] }
  })), [complaints]);

  const { clusters, supercluster } = useSupercluster({
    points, bounds, zoom, options: { radius: 50, maxZoom: 18 }
  });

  const updateMapBounds = useCallback((map) => {
    const b = map.getBounds();
    const sw = b.getSouthWest(); const ne = b.getNorthEast();
    const newBounds = [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()];
    setBounds(newBounds); setZoom(20 - map.getLevel());
  }, []);

  const clearSearch = () => { setKeyword(""); setSearchPlaces([]); setSelectedInfo(null); };

  const searchPlacesByKeyword = (sk) => {
    if (!window.kakao || !window.kakao.maps.services || !sk) return;
    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(sk, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const fmt = data.map(i => ({ type: 'general', id: i.id, title: i.place_name, lat: parseFloat(i.y), lng: parseFloat(i.x), address: i.road_address_name || i.address_name, category: i.category_group_name }));
        setSearchPlaces(fmt); setMapCenter({ lat: fmt[0].lat, lng: fmt[0].lng });
      }
    });
  };

  const confirmPickLocation = () => {
      setCompLocation({ lat: mapCenter.lat, lng: mapCenter.lng, address: "🗺️ 지도에서 선택된 위치" });
      setIsPickingLocation(false); setActiveTab("complaint"); 
    };

  const handleSearchTransit = async () => {
    // 1. 입력값 검사 (도착지는 필수!)
    if (!endPoint) return alert("도착지를 입력해주세요.");
    if (!graph) return alert("지도 데이터를 분석 중입니다. 잠시만요!");

    setTransitData(null);

    // 2. 주소(텍스트)를 좌표로 바꾸는 함수 (Promise 사용)
    const getCoords = (keyword, type) => {
      return new Promise((resolve, reject) => {
        
        // (1) '내 위치' 버튼을 눌렀거나, 빈칸이면 -> GPS 사용
        // 출발지(type === 'start')가 빈칸이면 자동으로 내 위치로 간주
        if (keyword === "📍 내 위치" || keyword === "내 위치" || (!keyword && type === 'start')) {
          resolve({ lat: myPos.lat, lng: myPos.lng, name: "현재 위치" });
          return;
        }

        // (2) 그 외 입력값이 있으면 -> 카카오 장소 검색 API로 좌표 찾기
        const ps = new window.kakao.maps.services.Places();
        ps.keywordSearch(keyword, (data, status) => {
          if (status === window.kakao.maps.services.Status.OK) {
            console.log(`🔎 검색 성공 [${type}]: ${data[0].place_name}`);
            resolve({
              lat: parseFloat(data[0].y),
              lng: parseFloat(data[0].x),
              name: data[0].place_name
            });
          } else {
            reject(`'${keyword}'을(를) 찾을 수 없습니다.`);
          }
        });
      });
    };

    try {
      // 3. 출발지 & 도착지 좌표 변환 (병렬 처리)
      // startPoint 상태값을 그대로 넘깁니다. (입력한 대로 검색)
      const startNode = await getCoords(startPoint, 'start'); 
      const endNode = await getCoords(endPoint, 'end');

      console.log(`🚀 경로 탐색 시작: ${startNode.name} -> ${endNode.name}`);

      // 4. 도착지 중심으로 지도 이동 (도착지를 보여주는 게 일반적)
      setMapCenter({ lat: endNode.lat, lng: endNode.lng });

      // 5. ODsay API에 '변환된 좌표'를 넣어서 경로 요청
      const result = await fetchTransitRoute(startNode.lng, startNode.lat, endNode.lng, endNode.lat);

      if (result) {
        // 6. 도보 구간만 '안심 경로'로 교체 (기존 로직 유지)
        const enhancedPath = result.path[0].subPath.map((segment) => {
          if (segment.trafficType === 3) { // 도보
            const start = `${segment.startX},${segment.startY}`;
            const end = `${segment.endX},${segment.endY}`;

            const weights = routeType === 'safe' 
              ? { cctv: userPrefs.cctv, blind: userPrefs.blind, light: 1 } 
              : { cctv: 0, blind: 0, light: 0 };

            const safePath = findSafePath(start, end, graph, weights);
            return { ...segment, safePath };
          }
          return segment;
        });

        setTransitData({ ...result, enhancedPath });
        alert(`[${startNode.name}] 에서 [${endNode.name}] 까지\n${routeType === 'safe' ? '🛡️ 안심' : '⚡ 최단'} 경로를 찾았습니다!`);
        setIsDirectionMode(false); 
      } else {
        alert("대중교통 경로를 찾을 수 없습니다.");
      }

    } catch (error) {
      console.error(error);
      alert("장소를 찾을 수 없습니다. 검색어를 확인해주세요.");
    }
  };

  // 상단 State 선언부
  const [compImage, setCompImage] = useState(null); // 사진 프리뷰 상태

  // 민원 삭제 함수 추가
  const handleDeleteComplaint = (id) => {
    if (window.confirm("이 민원을 삭제하시겠습니까?")) {
      deleteComplaint(id);
      alert("삭제되었습니다.");
    }
  };  

  // 내 민원들의 좋아요 총합 계산
  const totalLikes = useMemo(() => {
    return myComplaints.reduce((acc, myComp) => {
      // 전체 complaints 목록에서 내 민원(id가 일치하는 것)을 찾아 현재 좋아요 수를 더함
      const liveComp = complaints.find(c => c.id === myComp.id);
      return acc + (liveComp ? liveComp.likes : 0);
    }, 0);
  }, [complaints, myComplaints]);

  // 내 민원 1개당 100포인트 계산
  const totalPoints = myComplaints.length * 100;

  const handleSubmitComplaint = () => {
    if (!compTitle || !compContent) { alert("내용을 입력해주세요."); return; }
    const newComp = { id: Date.now(), type: 'complaint', lat: compLocation.lat, lng: compLocation.lng, title: compTitle, address: compLocation.address, date: new Date().toLocaleDateString(), reason: compContent, rating: compRating, likes: 0, dislikes: 0, image: compImage };
    addComplaint(newComp);
    setCompTitle(""); 
    setCompContent("");
    setCompRating(5);
    setCompImage(null);
    setCompLocation({ ...myPos, address: "📍 현재 위치" });
    alert("접수되었습니다!"); setActiveTab("home"); setMapCenter(newComp);
  };



  console.log({
    dataLength: geoData.length,      // 파일이 잘 불러와졌는지 (0보다 커야 함)
    currentZoom: zoom,               // 현재 줌 레벨이 얼마인지
    visibleCount: visibleRoads.length, // 지금 화면에 그려질 도로가 몇 개인지
    isBoundsReady: !!bounds          // 지도 영역 정보가 준비됐는지
  });

  if (loading) return <div className="flex items-center justify-center h-screen bg-black text-white font-bold animate-pulse">⏳ 시스템 로딩 중...</div>;

  if (error) return (
    <div className="flex items-center justify-center h-screen bg-red-50 text-red-600 font-bold p-4 text-center">
      ❌ 지도를 불러오지 못했습니다.<br/>
      (API 키 설정이나 네트워크를 확인해주세요)
    </div>
  );

  return (
    <div className="w-full h-screen bg-gray-900 flex justify-center items-center p-4">
      <div className="relative bg-white shadow-2xl overflow-hidden flex flex-col" style={{ width: "390px", height: "844px", borderRadius: "40px", border: "8px solid #1f2937" }}>
        
        {/* [1] 홈 화면 */}
        {activeTab === 'home' && (
          <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden">
            {!isPickingLocation && (
              <>
                <div className="absolute top-0 left-0 right-0 z-30 px-4 pt-14 pb-2 bg-gradient-to-b from-white/90 to-transparent">
                  {!isDirectionMode ? (
                    <div className="bg-white rounded-2xl shadow-md flex items-center p-3 border border-gray-100">
                      <Search className="text-gray-400 w-5 h-5 ml-1" />
                      <input type="text" placeholder="장소 검색" className="w-full ml-3 outline-none text-sm bg-transparent" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPlacesByKeyword(keyword)} />
                      {keyword.length > 0 && (
                        <button onClick={clearSearch} className="mr-2 text-gray-400 hover:text-gray-600 transition-colors">
                          <XCircle size={20} fill="#f3f4f6" stroke="currentColor" />
                        </button>
                      )}
                      <button onClick={() => setIsDirectionMode(true)} className="p-2 bg-blue-50 text-blue-600 rounded-lg active:scale-90 transition-transform"><ArrowRightLeft size={18} /></button>
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl shadow-lg p-4 border border-blue-100">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-bold text-blue-600 flex items-center gap-1"><Navigation size={14} /> 길찾기</h3>
                        <button onClick={() => setIsDirectionMode(false)} className="text-gray-400"><X size={18} /></button>
                      </div>
                      <div className="flex flex-col gap-2 mb-3">
                        <div className="relative">
                          <input type="text" placeholder="출발지" className="w-full bg-gray-50 p-2 pr-10 rounded text-sm border outline-none" value={startPoint} onChange={(e) => setStartPoint(e.target.value)} />
                          <button onClick={() => setStartPoint("📍 내 위치")} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-700"><Crosshair size={16} /></button>
                        </div>
                        <div className="relative">
                          <input type="text" placeholder="도착지" className="w-full bg-gray-50 p-2 pr-10 rounded text-sm border outline-none" value={endPoint} onChange={(e) => setEndPoint(e.target.value)} />
                          <button onClick={() => setEndPoint("📍 내 위치")} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-700"><Crosshair size={16} /></button>
                        </div>
                      </div>
                      <div className="flex gap-2 mb-3">
                        <button onClick={() => setRouteType("fast")} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${routeType === "fast" ? "bg-blue-600 text-white shadow-md" : "bg-gray-50 text-gray-400 border border-gray-100"}`}><Zap size={14} /> 최단 경로</button>
                        <button onClick={() => setRouteType("safe")} className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${routeType === "safe" ? "bg-green-600 text-white shadow-md" : "bg-gray-50 text-gray-400 border border-gray-100"}`}><ShieldCheck size={14} /> 안심 경로</button>
                      </div>

                      {/* ✨ [수정됨] 경로 버튼 바로 밑에 길찾기 안내 시작 버튼 추가 ✨ */}
                      <button 
                        onClick={handleSearchTransit} // 이 부분을 수정
                        className={`w-full py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg ...`}
                      >
                        <Navigation size={18} fill="white" /> 길찾기 시작
                      </button>
                    </div>
                  )}
                </div>

                <div className="absolute top-36 right-4 z-20 flex flex-col gap-3">
                  <button onClick={() => setShowRoute(!showRoute)} className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${showRoute ? "bg-green-500 text-white" : "bg-white text-gray-400"}`}><MapIcon size={20} /></button>
                  <button onClick={() => setShowComplaints(!showComplaints)} className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${showComplaints ? "bg-red-500 text-white" : "bg-white text-gray-400"}`}><Layers size={20} /></button>
                  <button onClick={() => setShowSafety(!showSafety)} className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${showSafety ? "bg-blue-600 text-white" : "bg-white text-gray-400"}`}><Shield size={20} /></button>
                </div>
              </>
            )}

            <div className="flex-1 w-full h-full relative">
              <Map center={mapCenter} style={{ width: "100%", height: "100%" }} level={3} ref={mapRef} onCreate={onMapCreated} onIdle={updateMapBounds} onDragEnd={(map) => setMapCenter({ lat: map.getCenter().getLat(), lng: map.getCenter().getLng() })}>
                {!isPickingLocation && (
                  <>
                    {/* 1. 배경 도로 표시 (데이터셋 기반의 전체 도로망) */}
                    {showRoute && visibleRoads.map((road) => (
                      <Polyline
                        key={road.id}
                        path={road.path}
                        strokeWeight={zoom > 16 ? 8 : 4} 
                        strokeColor={getSafetyColor(road.safety)}
                        strokeOpacity={0.7}
                      />
                    ))}

                    {/* 2. 대중교통 + 안심 도보 경로 표시 (길찾기 실행 시에만 등장) */}
                    {transitData && transitData.enhancedPath.map((segment, idx) => {
                      // A. 우리가 계산한 안심 도보 구간 (보라색 점선)
                      if (segment.trafficType === 3 && segment.safePath) {
                        return (
                          <Polyline
                            key={`safe-walk-${idx}`}
                            path={segment.safePath}
                            strokeWeight={10} // 경로니까 조금 더 두껍게
                            strokeColor="#8b5cf6" 
                            strokeStyle="dash"
                            strokeOpacity={0.9}
                          />
                        );
                      }

                      // B. 대중교통 구간 (지하철/버스)
                      if (segment.trafficType !== 3 && segment.passStopList) {
                        const coords = segment.passStopList.stations.map(s => ({
                          lat: parseFloat(s.y),
                          lng: parseFloat(s.x)
                        }));
                        return (
                          <Polyline
                            key={`transit-${idx}`}
                            path={coords}
                            strokeWeight={8}
                            strokeColor={segment.trafficType === 1 ? "#3498db" : "#2ecc71"}
                            strokeOpacity={0.8}
                          />
                        );
                      }
                      return null;
                    })}
                    {searchPlaces.map(p => <MapMarker key={p.id} position={p} onClick={() => setSelectedInfo(p)} />)}
                    {showComplaints && clusters.map(c => {
                      const [lng, lat] = c.geometry.coordinates;
                      if (c.properties.cluster) return (
                        <CustomOverlayMap key={`cluster-${c.id}`} position={{ lat, lng }}>
                          <div onClick={() => setSelectedInfo({ type: 'cluster_list', items: supercluster.getLeaves(c.id).map(l => l.properties) })} className="w-12 h-12 bg-red-600/90 rounded-full text-white flex items-center justify-center font-bold shadow-xl border-2 border-white cursor-pointer active:scale-95 transition-transform">{c.properties.point_count}</div>
                        </CustomOverlayMap>
                      );
                      return <MapMarker key={`comp-${c.properties.id}`} position={{ lat, lng }} image={{ src: "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png", size: { width: 24, height: 35 } }} onClick={() => setSelectedInfo({ type: 'complaint', ...c.properties })} />;
                    })}
                    {showSafety && policeData.map((p, i) => <MapMarker key={`p-${i}`} position={p} image={{ src: p.type === 'police' ? "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png" : "https://t1.daumcdn.net/mapjsapi/images/marker.png", size: { width: 24, height: 35 } }} onClick={() => setSelectedInfo(p)} />)}
                    {transitData && transitData.path[0].subPath.map((segment, idx) => {
                      // 도보(type 3)는 제외하거나 별도 처리
                      if (segment.trafficType === 3 || !segment.passStopList) return null;

                      // 정류장 좌표들을 추출하여 선으로 연결
                      const pathCoords = segment.passStopList.stations.map(s => ({
                        lat: parseFloat(s.y),
                        lng: parseFloat(s.x)
                      }));

                      return (
                        <Polyline
                          key={`transit-${idx}`}
                          path={pathCoords}
                          strokeWeight={6}
                          strokeColor={segment.trafficType === 1 ? "#3498db" : "#2ecc71"} // 지하철 파랑, 버스 초록
                          strokeOpacity={0.8}
                        />
                      );
                    })}
                    <CustomOverlayMap position={myPos}><div className="relative flex items-center justify-center"><div className="absolute w-8 h-8 bg-blue-500 rounded-full opacity-30 animate-ping"></div><div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg z-10"></div></div></CustomOverlayMap>
                  </>
                )}
                {isPickingLocation && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-50 pointer-events-none"><MapPin size={40} className="text-red-600 drop-shadow-xl" fill="white" /></div>}
              </Map>
              {isPickingLocation && (
                <div className="absolute bottom-10 left-4 right-4 z-50">
                  <button 
                    onClick={confirmPickLocation}
                    className="w-full py-4 bg-slate-800 text-white rounded-2xl font-black text-lg shadow-2xl active:scale-95 transition-all border-2 border-slate-700"
                  >
                    이 위치로 설정하기
                  </button>
                </div>
              )}
              {!isPickingLocation && (
                <button onClick={() => setMapCenter(myPos)} className="absolute bottom-6 right-4 z-20 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-blue-600 active:bg-blue-50 transition-colors">
                  {isGpsLoading ? <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" /> : <Crosshair size={24} />}
                </button>
              )}
            </div>

            {selectedInfo && (
              <div className="absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.2)] animate-slide-up p-5 pb-10 border-t border-gray-100">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-extrabold text-xl text-slate-800 flex items-center gap-2">
                      {selectedInfo.type === 'cluster_list' ? <Layers size={22} className="text-red-500"/> : <AlertCircle size={22} className="text-red-500"/>}
                      {selectedInfo.type === 'cluster_list' ? `민원 리스트 (${selectedInfo.items.length}건)` : selectedInfo.title}
                    </h3>
                    {selectedInfo.type === 'complaint' && (
                      <div className="flex gap-0.5 mt-1">{[...Array(5)].map((_, i) => (<Star key={i} size={14} fill={i < selectedInfo.rating ? "#facc15" : "none"} className={i < selectedInfo.rating ? "text-yellow-400" : "text-gray-200"} />))}</div>
                    )}
                  </div>
                  <button onClick={() => setSelectedInfo(null)} className="p-2 bg-gray-100 rounded-full transition-colors"><X size={20}/></button>
                </div>
                {selectedInfo.type === 'cluster_list' ? (
                  <div className="max-h-72 overflow-y-auto space-y-3">
                    {selectedInfo.items.map((item, idx) => (
                      <div key={idx} onClick={() => setSelectedInfo({ type: 'complaint', ...item })} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer active:bg-white transition-all">
                        <div className="flex justify-between mb-1"><span className="font-bold text-slate-800">{item.title}</span><span className="text-[10px] text-slate-400 font-bold">{item.date}</span></div>
                        <div className="flex items-center gap-2"><div className="flex gap-0.5">{[...Array(5)].map((_, i) => (<Star key={i} size={10} fill={i < item.rating ? "#facc15" : "none"} className={i < item.rating ? "text-yellow-400" : "text-gray-200"} />))}</div><span className="text-xs text-slate-500 truncate">{item.reason}</span></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl leading-relaxed">

                    <div className="space-y-0.5"> 
                      {/* 1. 주소 (mb-1 제거) */}
                      <div className="text-[11px] text-blue-500 font-bold flex items-center gap-1">
                        <MapPin size={10}/> {selectedInfo.address || "주소 정보 없음"}
                      </div>
                      
                      {/* 2. 운영시간 */}
                      {selectedInfo.hours && (
                        <div className="text-[11px] text-orange-600 font-bold flex items-center gap-1">
                          <Clock size={10}/> 운영시간: {selectedInfo.hours}
                        </div>
                      )}
                    </div>

                    {/* 추가)사진있으면 표시 */}
                    {(() => {
                      const liveData = complaints.find(c => c.id === selectedInfo.id) || selectedInfo;
                      return liveData.image && (
                        <div className="mt-3 w-full h-40 overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
                          <img src={liveData.image} className="w-full h-full object-cover" alt="민원 사진" />
                        </div>
                      );
                    })()}

                    {/* 3. 상세 내용 (공통) */}
                    <div className="text-slate-700 font-medium">
                      {selectedInfo.reason || selectedInfo.category}
                    </div>

                    {/* 4. 좋아요/싫어요 버튼 (민원 'complaint' 타입일 때만 노출) */}
                    {selectedInfo.type === 'complaint' && (() => {
                      const liveData = complaints.find(c => c.id === selectedInfo.id) || selectedInfo;
                      const myReaction = userReactions[liveData.id];

                      return (
                        <div className="flex gap-6 mt-4 pl-1 border-t border-slate-200 pt-4">
                          <button 
                            onClick={() => handleReaction(liveData.id, 'likes')} 
                            className={`flex items-center gap-2 font-bold transition-all ${myReaction === 'likes' ? 'text-red-600 scale-105' : 'text-slate-400'}`}
                          >
                            <ThumbsUp size={18} fill={myReaction === 'likes' ? "currentColor" : "none"}/> 
                            {liveData.likes}
                          </button>
                          
                          <button 
                            onClick={() => handleReaction(liveData.id, 'dislikes')} 
                            className={`flex items-center gap-2 font-bold transition-all ${myReaction === 'dislikes' ? 'text-blue-600 scale-105' : 'text-slate-400'}`}
                          >
                            <ThumbsDown size={18} fill={myReaction === 'dislikes' ? "currentColor" : "none"}/> 
                            {liveData.dislikes}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* [2] 민원 신청 화면 */}
        {activeTab === 'complaint' && (
          <div className="flex-1 w-full bg-gray-50 flex flex-col p-6 pt-14 overflow-y-auto scrollbar-thin">
            <h2 className="text-3xl font-black text-slate-800 mb-8">민원 신청</h2>
            <div className="space-y-6">
              <div><label className="text-sm font-bold text-gray-700 ml-1">민원 제목</label><input type="text" placeholder="예: 보도블럭 파손" className="w-full mt-2 p-4 bg-white border border-slate-200 rounded-2xl outline-none font-medium" value={compTitle} onChange={(e)=>setCompTitle(e.target.value)} /></div>
              <div>
                <label className="text-sm font-bold text-gray-700 ml-1">발생 위치</label>
                <div className="flex flex-col gap-2 mt-2">
                  <div className="p-4 bg-white border border-slate-200 rounded-2xl text-xs flex items-center gap-2 font-bold text-blue-600 truncate shadow-sm"><MapPin size={16}/>{compLocation.address}</div>
                  <div className="flex gap-2">
                    <button onClick={() => {setCompLocation({ ...myPos, address: "📍 현재 위치" }); alert("현재 위치로 설정되었습니다.");}} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold active:bg-blue-700 shadow-lg shadow-blue-100">현 위치로</button>
                    <button onClick={() => { setIsPickingLocation(true); setActiveTab("home"); }} className="flex-1 py-3 bg-white text-blue-600 border border-blue-100 rounded-2xl text-sm font-bold active:bg-blue-50">지도 선택</button>
                  </div>
                </div>
              </div>
              <div><label className="text-sm font-bold text-gray-700 ml-1">안전도 (별점)</label><div className="flex gap-2 mt-2">{[1,2,3,4,5].map(s => <Star key={s} onClick={()=>setCompRating(s)} className={`cursor-pointer transition-all ${s<=compRating?'text-yellow-400 scale-110':'text-slate-200'}`} fill={s<=compRating?"currentColor":"none"} size={36} />)}</div></div>
              <div>
                <label className="text-sm font-bold text-gray-700 ml-1">사진 첨부</label>
                <div className="mt-2 flex gap-4 items-center">
                  <label className="w-16 h-16 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 cursor-pointer hover:bg-slate-50">
                    <Camera size={24} />
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => setCompImage(URL.createObjectURL(e.target.files[0]))} />
                  </label>
                  {compImage && (
                    <div className="relative w-16 h-16">
                      <img src={compImage} className="w-full h-full object-cover rounded-2xl" alt="preview" />
                      <button onClick={() => setCompImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5"><X size={12}/></button>
                    </div>
                  )}
                </div>
              </div>
              <div><label className="text-sm font-bold text-gray-700 ml-1">상세 내용</label><textarea placeholder="내용을 적어주세요." className="w-full mt-2 p-4 h-32 bg-white border border-slate-200 rounded-2xl outline-none resize-none text-sm font-medium" value={compContent} onChange={(e)=>setCompContent(e.target.value)} /></div>
              <button onClick={handleSubmitComplaint} className="w-full py-5 bg-slate-800 text-white rounded-2xl font-extrabold text-lg shadow-xl active:scale-95 transition-all mt-4 mb-10">민원 접수</button>
            </div>
          </div>
        )}

        {/* [3] 안심 귀가 탭 */}
        {activeTab === 'safe_return' && (
          <div className="flex-1 w-full bg-slate-50 flex flex-col p-6 pt-14 overflow-y-auto">
            <h2 className="text-3xl font-black mb-8 text-slate-800">안심 귀가 & 민원</h2>
            <div className="space-y-5">
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-3 mb-3"><ShieldCheck className="text-green-600" size={24}/><h3 className="font-bold text-lg text-slate-800">안심귀가 스카우트</h3></div>
                <button onClick={()=>alert("120 다산콜센터로 연결합니다.")} className="w-full py-4 bg-green-50 text-green-700 border border-green-100 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:bg-green-100 transition-colors"><PhoneCall size={18}/>전화 신청 (120)</button>
              </div>
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-3 mb-3"><AlertCircle className="text-blue-600" size={24}/><h3 className="font-bold text-lg text-slate-800">안전신문고</h3></div>
                <button onClick={()=>window.open('https://www.safetyreport.go.kr/')} className="w-full py-4 bg-blue-50 text-blue-700 border border-blue-100 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:bg-blue-100 transition-colors"><ExternalLink size={18}/>안전신문고 바로가기</button>
              </div>
            </div>
          </div>
        )}

        {/* [4] 기타/메뉴 탭 */}
          {activeTab === 'menu' && (
            <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-y-auto scrollbar-thin">
              {/* 1. 상단 프로필 섹션 */}
              <div className="bg-white px-6 pt-16 pb-8 rounded-b-[40px] shadow-sm border-b border-slate-100">
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-[28px] flex items-center justify-center text-white shadow-lg">
                      <User size={40} />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-green-500 rounded-full border-4 border-white flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-black text-slate-800">사용자 님</h2>
                      <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded-md border border-blue-100 tracking-tighter uppercase">SeoulTech</span>
                    </div>
                    <p className="text-slate-400 text-sm font-medium mt-0.5">안심 지킴이 LV.1</p>
                  </div>
                </div>

                {/* 2. 기여도 대시보드 */}
                <div className="grid grid-cols-3 gap-3 mt-8">
                  <div className="bg-slate-50 p-3 rounded-2xl text-center border border-slate-100 transition-transform active:scale-95">
                    <p className="text-[10px] font-bold text-slate-400 mb-1">내 민원</p>
                    <p className="text-lg font-black text-slate-800">{myComplaints.length}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl text-center border border-slate-100 transition-transform active:scale-95">
                    <p className="text-[10px] font-bold text-slate-400 mb-1">받은 공감</p>
                    <p className="text-lg font-black text-red-500">{totalLikes}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl text-center border border-slate-100 transition-transform active:scale-95">
                    <p className="text-[10px] font-bold text-slate-400 mb-1">포인트</p>
                    <p className="text-lg font-black text-blue-600">{totalPoints}</p>
                  </div>
                </div>
              </div>

              {/* 3. 메뉴 리스트 */}
              <div className="p-6 space-y-6">
                {/* 그룹: 나의 활동 */}
                <div>
                  <p className="text-xs font-black text-slate-400 ml-2 mb-3 uppercase tracking-widest">Activity</p>
                  <div className="bg-white rounded-[32px] p-2 shadow-sm border border-slate-100">
                    <button 
                          onClick={() => setActiveTab('my_complaints')} 
                          className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all group"
                        >
                          <div className="flex items-center gap-4">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                              <FileText size={20}/>
                            </div>
                            <span className="font-bold text-slate-700">민원 처리 내역</span>
                          </div>
                          <ChevronRight size={18} className="text-slate-300"/>
                        </button>
                    <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-pink-50 text-pink-600 rounded-xl group-hover:bg-pink-600 group-hover:text-white transition-colors">
                          <Heart size={20}/>
                        </div>
                        <span className="font-bold text-slate-700">찜한 안심 장소</span>
                      </div>
                      <ChevronRight size={18} className="text-slate-300"/>
                    </button>
                  </div>
                </div>

                {/* 그룹: 설정 및 지원 */}
                <div>
                  <p className="text-xs font-black text-slate-400 ml-2 mb-3 uppercase tracking-widest">Support & Settings</p>
                  <div className="bg-white rounded-[32px] p-2 shadow-sm border border-slate-100">
                    <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-600 group-hover:text-white transition-colors">
                          <Bell size={20}/>
                        </div>
                        <span className="font-bold text-slate-700">공지사항</span>
                      </div>
                      <ChevronRight size={18} className="text-slate-300"/>
                    </button>
                    <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-slate-50 text-slate-600 rounded-xl group-hover:bg-slate-600 group-hover:text-white transition-colors">
                          <Settings size={20}/>
                        </div>
                        <span className="font-bold text-slate-700">앱 환경 설정</span>
                      </div>
                      <ChevronRight size={18} className="text-slate-300"/>
                    </button>
                  </div>
                </div>

                {/* 로그아웃 */}
                <button className="w-full py-5 bg-white text-red-500 rounded-[32px] font-black shadow-sm border border-red-50 flex items-center justify-center gap-2 active:scale-95 active:bg-red-50 transition-all">
                  <LogOut size={20}/> 로그아웃
                </button>

                {/* 푸터 정보 */}
                <div className="text-center pb-10">
                  <p className="text-[10px] font-bold text-slate-300">App Version 1.2.4 (Stable)</p>
                  <p className="text-[10px] font-bold text-slate-300 mt-1 uppercase">© 2026 SeoulTech Safety Map AI Project</p>
                </div>
              </div>
            </div>
          )}

        {/* [5] 내 민원 내역 전용 페이지 */}
        {activeTab === 'my_complaints' && (
          <div className="flex-1 w-full bg-slate-50 flex flex-col pt-14 overflow-y-auto scrollbar-thin">
            <div className="px-6 flex items-center gap-3 mb-6">
              <button 
                onClick={() => setActiveTab('menu')} 
                className="p-2 bg-white rounded-full shadow-sm active:scale-90 transition-transform"
              >
                <ChevronRight size={20} className="rotate-180 text-slate-600" />
              </button>
              <h2 className="text-2xl font-black text-slate-800">내 민원 내역</h2>
            </div>

            <div className="px-6 pb-10 space-y-4">
              {myComplaints.length === 0 ? (
                <div className="text-center py-20">
                  <AlertCircle size={40} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-400 font-bold">작성한 민원이 없습니다.</p>
                </div>
              ) : (
                myComplaints.map((item) => {
                  // 실시간 좋아요 수 동기화
                  const liveData = complaints.find(c => c.id === item.id) || item;
                  return (
                    <div key={item.id} className="bg-white p-5 rounded-[32px] shadow-sm border border-slate-100 relative">
                      {/* 1. 우측 상단 삭제 버튼 */}
                      <button 
                        onClick={() => handleDeleteComplaint(item.id)}
                        className="absolute top-5 right-5 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <XCircle size={20} />
                      </button>

                      {/* 2. 제목과 날짜 */}
                      <div className="pr-8 mb-2">
                        <h3 className="font-bold text-slate-800 text-base">{item.title}</h3>
                        <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg">
                          {item.date}
                        </span>
                      </div>

                      {/* 3. ✨ 사진 표시 (지도 상세창과 동일한 라운드/커버 적용) */}
                      {item.image && (
                        <div className="mt-3 mb-3 w-full h-32 overflow-hidden rounded-2xl border border-slate-50 shadow-sm">
                          <img src={item.image} className="w-full h-full object-cover" alt="민원 사진" />
                        </div>
                      )}
                      
                      {/* 4. 민원 내용 */}
                      <p className="text-xs text-slate-500 leading-relaxed mb-4">{item.reason}</p>
                      
                      {/* 5. 하단 정보 (별점 & 공감 수치) */}
                      <div className="flex items-center justify-between border-t border-slate-50 pt-4">
                        <div className="flex gap-0.5">
                          {[...Array(5)].map((_, i) => (
                            <Star key={i} size={12} fill={i < item.rating ? "#facc15" : "none"} className={i < item.rating ? "text-yellow-400" : "text-slate-200"} />
                          ))}
                        </div>
                        
                        <div className="flex gap-2">
                          <div className="flex items-center gap-1 text-[10px] font-black text-red-500 bg-red-50 px-2.5 py-1 rounded-full">
                            <ThumbsUp size={10} fill="currentColor" /> 
                            {complaints.find(c => c.id === item.id)?.likes || 0}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-black text-blue-500 bg-blue-50 px-2.5 py-1 rounded-full">
                            <ThumbsDown size={10} fill="currentColor" /> 
                            {complaints.find(c => c.id === item.id)?.dislikes || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 탭바 하단 고정 - 탭바는 그대로 유지 */}
        {!isPickingLocation && (
          <div className="h-24 bg-white border-t border-slate-100 flex justify-around items-center shrink-0 z-30 pb-8 px-4">
            <div className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all ${activeTab === 'home' ? 'text-blue-600 scale-110' : 'text-slate-300'}`} onClick={() => setActiveTab('home')}><MapIcon size={26} fill={"none"}/><span className="text-[10px] font-black">홈</span></div>
            <div className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all ${activeTab === 'complaint' ? 'text-blue-600 scale-110' : 'text-slate-300'}`} onClick={() => setActiveTab('complaint')}><FileText size={26} /><span className="text-[10px] font-black">민원 신청</span></div>
            <div className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all ${activeTab === 'safe_return' ? 'text-blue-600 scale-110' : 'text-slate-300'}`} onClick={() => setActiveTab('safe_return')}><ShieldCheck size={26} /><span className="text-[10px] font-black">안심 귀가</span></div>
            <div className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all ${activeTab === 'menu' ? 'text-blue-600 scale-110' : 'text-slate-300'}`} onClick={() => setActiveTab('menu')}><Menu size={26} /><span className="text-[10px] font-black">기타</span></div>
          </div>
        )}
      </div>
    </div>
  );
}