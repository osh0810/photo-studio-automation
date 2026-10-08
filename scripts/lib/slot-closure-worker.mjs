export async function processSlotClosure({api,close}) {
 const {job}=await api('POST',{action:'claim_slot_closure'});
 if(!job)return false;
 let status='closed',result;
 try {
  result=await close(job.shoot_date);
  if(result?.verified!==true||!(result.total>0))throw new Error('CLOSURE_NOT_VERIFIED');
 }catch(error){
  status=error.code==='LOGIN_REQUIRED'?'login_required':'failed';
  console.error(`${new Date().toISOString()} [slot closure] ${error.detail || error.code || 'CLOSURE_NOT_VERIFIED'}`);
 }
 await api('POST',{action:'complete_slot_closure',booking_id:job.booking_id,claim_id:job.claim_id,status,result});
 return {loginRequired:status==='login_required'};
}
