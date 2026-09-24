import importlib.util,pathlib,tempfile,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('screen_agent',pathlib.Path(__file__).with_name('elise-screen-agent.py'))
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
class ScreenAgentTests(unittest.TestCase):
 def setUp(self):
  original=agent.write
  writer=patch.object(agent,'write',side_effect=lambda path,data:None if path in (agent.CEC_STATUS,agent.MEDIA_STATUS) else original(path,data));self.write=writer.start();self.addCleanup(writer.stop)
 def test_stable_display_does_not_reset_cec_link(self):
  query='DP-3 connected primary 1920x1080+0+0\n   1920x1080 60.00*+\n'
  with patch.object(agent,'run',return_value=query) as run:
   self.assertEqual(agent.configure_outputs([]),'DP-3')
   run.assert_called_once_with(['xrandr','--query'])
 def test_hdmi_is_preferred_over_displayport_and_uses_stable_1080p(self):
  query='Screen 0\nDP-3 connected\n   3840x2160 30.00 +\n   1920x1080 60.00\nHDMI-2 connected\n   3840x2160 30.00 +\n   1920x1080 60.00*\n'
  with patch.object(agent,'run',side_effect=[query,'']) as run:
   with patch.object(agent,'try_run') as optional:
    self.assertEqual(agent.configure_outputs(['display']),'HDMI-2')
    run.assert_any_call(['display','xrandr','--output','HDMI-2','--mode','1920x1080','--primary','--pos','0x0'],5)
    optional.assert_called_with(['display','xrandr','--output','DP-3','--off'])
 def test_display_falls_back_to_its_preferred_mode(self):
  outputs=agent.display_outputs('DP-1 connected\n   2560x1440 59.95 +\n   1280x720 60.00*\n')
  self.assertEqual(agent.output_mode(outputs['DP-1']),'2560x1440')
 def test_hdmi_audio_sink_receives_real_volume_and_usb_microphone(self):
  def response(args,timeout=20):
   command=' '.join(args)
   if 'list short sinks' in command:return '1\talsa_output.analog\tx\n2\talsa_output.hdmi-stereo\tx'
   if 'list short sink-inputs' in command:return '7\tstream'
   if 'list short sources' in command:return '3\talsa_output.hdmi.monitor\tx\n4\talsa_input.usb-mic\tx'
   return ''
  with patch.object(agent,'try_run',side_effect=response) as run:
   self.assertEqual(agent.configure_audio(['env'],42),'alsa_output.hdmi-stereo')
   run.assert_any_call(['env','pactl','set-sink-volume','alsa_output.hdmi-stereo','42%'])
   run.assert_any_call(['env','pactl','move-sink-input','7','alsa_output.hdmi-stereo'])
   run.assert_any_call(['env','pactl','set-default-source','alsa_input.usb-mic'])
 def test_detect_media_finds_camera_and_physical_microphones(self):
  nodes=[pathlib.Path('/dev/video0'),pathlib.Path('/dev/video1')]
  def response(args,timeout=20):
   if 'v4l2-ctl' in args:
    if args[args.index('--device')+1]=='/dev/video0':
     return 'Card type : Trust USB Camera: Trust USB Cam\nDevice Caps : 0x04200001\n\tVideo Capture\n\tStreaming\nMedia Driver Info\n'
    return 'Device Caps : 0x00800000\n\tMetadata Capture\nMedia Driver Info\n'
   if args[-4:]==['pactl','list','short','sources']:
    return '0\talsa_output.hdmi.monitor\tx\n1\talsa_input.usb-Trust_Camera\tx\n2\talsa_input.usb-Blue_Snowball\tx'
   return ''
  with patch.object(agent.pathlib.Path,'glob',return_value=nodes),patch.object(agent,'try_run',side_effect=response):
   media=agent.detect_media(['env'])
  self.assertTrue(media['camera'])
  self.assertTrue(media['microphone'])
  self.assertEqual(media['cameraDevices'],[{'path':'/dev/video0','name':'Trust USB Camera: Trust USB Cam'}])
  self.assertEqual(media['microphoneDevices'],[{'name':'alsa_input.usb-Trust_Camera'},{'name':'alsa_input.usb-Blue_Snowball'}])
 def test_cec_wakes_tv_and_selects_elise_input(self):
  completed=Mock(returncode=0,stdout='power status: on',stderr='')
  with patch.object(agent.shutil,'which',return_value='/usr/bin/cec-client'),patch.object(agent,'try_run',return_value='device: 1'),patch.object(agent.subprocess,'run',return_value=completed) as run:
   self.assertTrue(agent.control_cec(False))
   run.assert_called_once_with(['cec-client','-s','-d','1'],input='on 0\nas\npow 0\n',check=False,capture_output=True,text=True,timeout=8)
 def test_cec_is_not_claimed_without_an_adapter(self):
  with patch.object(agent.shutil,'which',return_value='/usr/bin/cec-client'),patch.object(agent,'try_run',return_value='Found devices: NONE'):
   self.assertFalse(agent.control_cec(False))
 def test_native_cec_wakes_tv_and_uses_detected_input(self):
  adapter={'device':'/dev/cec0','name':'DP-3','physicalAddress':'2.0.0.0','configured':False}
  with patch.object(agent.shutil,'which',return_value='/usr/bin/cec-ctl'),patch.object(agent,'native_cec_adapters',return_value=[adapter]),patch.object(agent,'try_run') as configure,patch.object(agent,'cec_transmit',return_value=(True,'pwr-state: on\n')) as transmit:
   self.assertTrue(agent.control_cec(False,'DP-3'))
   configure.assert_called_once()
   transmit.assert_any_call(['cec-ctl','-s','-d','/dev/cec0','--to','0','--image-view-on'])
   transmit.assert_any_call(['cec-ctl','-s','-d','/dev/cec0','--active-source','phys-addr=2.0.0.0'])
   self.assertTrue(self.write.call_args.args[1]['tvAcknowledged'])
 def test_native_cec_nack_is_not_success_even_with_zero_exit(self):
  with patch.object(agent.subprocess,'run',return_value=Mock(returncode=0,stdout='Tx, NACK, Max Retries',stderr='')):
   self.assertFalse(agent.cec_transmit(['cec-ctl'])[0])
 def test_native_cec_ack_is_recognized(self):
  with patch.object(agent.subprocess,'run',return_value=Mock(returncode=0,stdout='Tx, OK\n',stderr='')):
   self.assertTrue(agent.cec_transmit(['cec-ctl'])[0])
 def test_invalid_physical_address_never_claims_active_source(self):
  adapter={'device':'/dev/cec0','name':'DP-3','physicalAddress':'f.f.f.f','configured':True}
  with patch.object(agent.shutil,'which',return_value='cec-ctl'),patch.object(agent,'native_cec_adapters',return_value=[adapter]),patch.object(agent,'cec_transmit',return_value=(True,'Tx, OK')) as transmit:
   self.assertFalse(agent.control_cec(False,'DP-3'))
   self.assertFalse(any('--active-source' in call.args[0] for call in transmit.call_args_list))
 def test_usb_cec_without_tv_reply_is_not_claimed_working(self):
  with patch.object(agent.shutil,'which',return_value='cec-client'),patch.object(agent,'try_run',return_value='device: 1'),patch.object(agent.subprocess,'run',return_value=Mock(returncode=0,stdout='',stderr='')):
   self.assertFalse(agent.control_libcec(False))
 def test_native_cec_standby_does_not_wake_or_claim_source(self):
  adapter={'device':'/dev/cec0','name':'DP-3','physicalAddress':'1.0.0.0','configured':True}
  with patch.object(agent.shutil,'which',return_value='cec-ctl'),patch.object(agent,'native_cec_adapters',return_value=[adapter]),patch.object(agent,'cec_transmit',return_value=(True,'Tx, OK')) as transmit:
   self.assertTrue(agent.control_cec(True,'DP-3'))
   transmit.assert_called_once_with(['cec-ctl','-s','-d','/dev/cec0','--to','0','--standby'])
 def test_raspberry_dual_hdmi_mapping(self):
  self.assertEqual(agent.cec_connector('vc4-hdmi-0'),'HDMI-1')
  self.assertEqual(agent.cec_connector('vc4-hdmi-1'),'HDMI-2')
 def test_native_adapter_for_another_tv_is_excluded(self):
  info='Adapter Name : HDMI-2\nPhysical Address : 1.0.0.0\nLogical Address : 4'
  with patch.object(agent.pathlib.Path,'glob',return_value=[pathlib.Path('/dev/cec1')]),patch.object(agent,'try_run',return_value=info):
   self.assertEqual(agent.native_cec_adapters('HDMI-1'),[])
 def test_cec_keeps_running_when_api_and_display_are_down(self):
  with patch.object(agent,'read',return_value={'token':'paired','asleep':False,'volume':42,'selected':'DP-3'}),patch.object(agent,'device',side_effect=OSError('offline')),patch.object(agent,'run',side_effect=OSError('X unavailable')),patch.object(agent,'control_cec',return_value=True) as cec,patch.object(agent.time,'sleep',side_effect=RuntimeError('end test')):
   with self.assertRaisesRegex(RuntimeError,'end test'):agent.display_loop()
   cec.assert_called_once_with(False,'DP-3')
 def test_invalid_interface_never_runs_network_commands(self):
  with patch.object(agent,'run') as run,patch.object(agent.socket,'if_nameindex',return_value=[(1,'eth0')]):
   with self.assertRaises(ValueError):agent.configure_network({'enabled':True,'primaryInterface':'eth0;reboot','apn':'free'})
   run.assert_not_called()
 def test_disabling_persists_without_reconfiguring_primary_interface(self):
  with tempfile.TemporaryDirectory() as folder,patch.object(agent,'run') as run:
   with patch.object(agent,'NETWORK',pathlib.Path(folder)/'network.json'):
    agent.configure_network({'enabled':False});self.assertEqual(agent.read(agent.NETWORK),{'enabled':False});run.assert_not_called()
 def test_invalid_pin_rejected(self):
  with patch.object(agent.socket,'if_nameindex',return_value=[(1,'eth0')]):
   with self.assertRaises(ValueError):agent.configure_network({'enabled':True,'primaryInterface':'eth0','apn':'free','pin':'1234; reboot'})
if __name__=='__main__':unittest.main()
