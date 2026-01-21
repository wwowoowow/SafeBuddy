import { useState } from 'react';
import { initialComplaints } from '../data/mockData';

export const useComplaints = () => {
  const [complaints, setComplaints] = useState(initialComplaints); // 전체 민원
  const [myComplaints, setMyComplaints] = useState([]); // 내 민원
  const [userReactions, setUserReactions] = useState({}); // 좋아요 기록

  // 민원 추가
  const addComplaint = (newComp) => {
    setComplaints(prev => [...prev, newComp]);
    setMyComplaints(prev => [...prev, newComp]);
  };

  // 민원 삭제
  const deleteComplaint = (id) => {
    setComplaints(prev => prev.filter(c => c.id !== id));
    setMyComplaints(prev => prev.filter(c => c.id !== id));
  };

  // 좋아요/싫어요 처리
  const handleReaction = (id, type) => {
    const currentReaction = userReactions[id];

    setComplaints(prev => prev.map(c => {
      if (c.id === id) {
        let newLikes = c.likes;
        let newDislikes = c.dislikes;

        if (currentReaction === 'likes') newLikes--;
        if (currentReaction === 'dislikes') newDislikes--;

        if (currentReaction !== type) {
          if (type === 'likes') newLikes++;
          if (type === 'dislikes') newDislikes++;
        }
        return { ...c, likes: newLikes, dislikes: newDislikes };
      }
      return c;
    }));

    setUserReactions(prev => {
      const next = { ...prev };
      if (currentReaction === type) delete next[id];
      else next[id] = type;
      return next;
    });
  };

  return { 
    complaints, myComplaints, userReactions, 
    addComplaint, deleteComplaint, handleReaction 
  };
};