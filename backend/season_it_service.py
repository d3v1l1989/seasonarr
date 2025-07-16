import asyncio
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from models import SonarrInstance, UserSettings, ActivityLog
from sonarr_client import SonarrClient
from websocket_manager import manager
from bulk_operation_manager import bulk_operation_manager
from datetime import datetime

logger = logging.getLogger(__name__)

class SeasonItService:
    def __init__(self, db: Session, user_id: int):
        self.db = db
        self.user_id = user_id

    def _create_activity_log(self, instance_id: int, show_id: int, show_title: str, season_number: Optional[int] = None) -> ActivityLog:
        """Create a new activity log entry"""
        activity = ActivityLog(
            user_id=self.user_id,
            instance_id=instance_id,
            action_type="season_it",
            show_id=show_id,
            show_title=show_title,
            season_number=season_number,
            status="in_progress",
            message=f"Started Season It for {show_title}" + (f" Season {season_number}" if season_number else " (All Seasons)")
        )
        self.db.add(activity)
        self.db.commit()
        self.db.refresh(activity)
        return activity

    def _update_activity_log(self, activity: ActivityLog, status: str, message: str = None, error_details: str = None):
        """Update an activity log entry"""
        activity.status = status
        if message:
            activity.message = message
        if error_details:
            activity.error_details = error_details
        if status in ["success", "error"]:
            activity.completed_at = datetime.utcnow()
        self.db.commit()

    async def process_season_it(self, show_id: int, season_number: Optional[int] = None, instance_id: Optional[int] = None) -> Dict[str, Any]:
        activity = None
        try:
            # Get series data first so we can include poster info
            instance = self._get_sonarr_instance_by_id(instance_id) if instance_id else self._get_sonarr_instance(show_id)
            if not instance:
                raise Exception("No Sonarr instance found for this show")

            client = SonarrClient(instance.url, instance.api_key, instance.id)
            series_data = await self._get_series_data(client, show_id)
            show_title = series_data.get("title", "Unknown Show")
            poster_url = client._get_banner_url(series_data.get("images", []), client.instance_id)

            # Send enhanced progress update instead of regular one
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single" if season_number else "season_it_all",
                "🚀 Initializing Season It process...", 
                10,
                current_step="Initialize",
                details={"poster_url": poster_url, "season_number": season_number}
            )

            # Create activity log entry
            activity = self._create_activity_log(instance.id, show_id, show_title, season_number)

            if season_number:
                result = await self._process_single_season_with_data(client, show_id, season_number, show_title, series_data)
            else:
                result = await self._process_all_seasons(client, show_id, show_title, series_data)

            # Update activity log on success
            self._update_activity_log(
                activity, 
                "success", 
                f"Season It completed successfully for {show_title}" + (f" Season {season_number}" if season_number else " (All Seasons)")
            )
            
            return result

        except Exception as e:
            # Update activity log on error
            if activity:
                self._update_activity_log(
                    activity, 
                    "error", 
                    f"Season It failed for {activity.show_title}",
                    str(e)
                )
            
            await manager.send_enhanced_progress_update(
                self.user_id, 
                activity.show_title if activity else "Unknown Show",
                "season_it_error",
                f"❌ Season It failed: {str(e)}", 
                100, 
                "error",
                current_step="Error",
                details={"error": str(e)}
            )
            raise

    async def _process_single_season_with_data(self, client: SonarrClient, show_id: int, season_number: int, show_title: str, series_data: Dict) -> Dict[str, Any]:
        """Enhanced single season processing with detailed progress tracking (15+ steps)"""
        
        # Get poster URL from the series data
        poster_url = client._get_poster_url(series_data.get("images", []), client.instance_id)
        
        return await self._process_single_season(client, show_id, season_number, show_title, poster_url, series_data)

    async def _process_single_season(self, client: SonarrClient, show_id: int, season_number: int, show_title: str, poster_url: str = None, series_data: Dict = None) -> Dict[str, Any]:
        """Enhanced single season processing with detailed progress tracking (15+ steps)"""
        
        # If series_data is not provided, fetch it
        if series_data is None:
            series_data = await self._get_series_data(client, show_id)
            poster_url = client._get_banner_url(series_data.get("images", []), client.instance_id)
        
        # Step 1: Initialize process
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🔄 Initializing Season It for {show_title} Season {season_number}...", 
            5,
            current_step="Initialize",
            details={"poster_url": poster_url, "season_number": season_number}
        )
        
        # Step 2: Check for future episodes
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"📅 Checking if Season {season_number} has unaired episodes...", 
            8,
            current_step="Check Future Episodes",
            details={"poster_url": poster_url, "season_number": season_number}
        )
        
        future_check = await client.has_future_episodes(show_id, season_number)
        if season_number in future_check.get("seasons_incomplete", []):
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single",
                f"⏳ Season {season_number} of '{show_title}' has episodes that haven't aired yet. Skipping Season It to avoid incomplete season packs.", 
                100, 
                "warning",
                current_step="Complete",
                details={"poster_url": poster_url, "season_number": season_number}
            )
            return {"status": "incomplete_season", "message": "Season has episodes that haven't aired yet"}
        
        # Step 3: Validate series data
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"📋 Validating series data for {show_title}...", 
            10,
            current_step="Validate Data",
            details={"poster_url": poster_url, "season_number": season_number}
        )
        
        # Step 4: Check for missing episodes
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🔍 Scanning for missing episodes in Season {season_number}...", 
            15,
            current_step="Scan Episodes",
            details={"poster_url": poster_url, "season_number": season_number}
        )

        missing_data = await client.get_missing_episodes(show_id, season_number)
        seasons_with_missing = missing_data.get("seasons_with_missing", {})
        
        logger.info(f"Missing episodes data for series {show_id} season {season_number}: {missing_data}")
        
        if season_number not in seasons_with_missing:
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single",
                f"✅ Season {season_number} of '{show_title}' has no missing episodes", 
                100, 
                "warning",
                current_step="Complete",
                details={"poster_url": poster_url, "season_number": season_number}
            )
            return {"status": "no_missing_episodes", "message": "No missing episodes found"}

        missing_count = len(seasons_with_missing[season_number])
        
        # Step 4: Load user settings
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"⚙️ Loading user preferences and settings...", 
            20,
            current_step="Load Settings",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        settings = self.db.query(UserSettings).filter(UserSettings.user_id == self.user_id).first()
        skip_season_pack_check = settings and settings.disable_season_pack_check
        
        # Step 5: Determine processing strategy
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🎯 Determining optimal processing strategy for {missing_count} missing episodes...", 
            25,
            current_step="Strategy",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        if skip_season_pack_check:
            # Strategy: Skip season pack search
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single",
                f"📝 Season pack check disabled - using regular search strategy...", 
                30,
                current_step="Skip Season Pack",
                details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
            )
            
            if settings and settings.skip_episode_deletion:
                # Step 6a: Skip deletion path
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"⚠️ Skipping episode deletion as per user settings...", 
                    35,
                    current_step="Skip Deletion",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                )
                logger.info(f"Skipping season pack search and episode deletion for series {show_id} season {season_number} due to user settings")
            else:
                # Step 6b: Delete episodes path
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"🗑️ Preparing to delete {missing_count} individual episodes...", 
                    35,
                    current_step="Prepare Deletion",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                )
                
                # Step 7: Execute deletion
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"🧹 Deleting existing episodes from Season {season_number}...", 
                    40,
                    current_step="Execute Deletion",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                )
                
                logger.info(f"Deleting episodes for series {show_id} season {season_number}")
                await client.delete_season_episodes(show_id, season_number)
                
                # Step 8: Confirm deletion
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"✅ Episode deletion completed successfully...", 
                    45,
                    current_step="Confirm Deletion",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                )
        else:
            # Strategy: Check for season packs first
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single",
                f"🔍 Searching for available season packs...", 
                30,
                current_step="Search Season Packs",
                details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
            )

            # Step 6: Search for season packs
            logger.info(f"Searching for season packs for series {show_id} season {season_number}")
            releases = await client._get_releases(show_id, season_number)
            logger.info(f"Found {len(releases)} season packs")
            
            # Step 7: Analyze season pack results
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_single",
                f"📊 Analyzing {len(releases)} available season packs...", 
                35,
                current_step="Analyze Season Packs",
                current_step_number=7,
                total_steps=17,
                details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count, "releases_found": len(releases)}
            )
            
            if not releases:
                # Step 8a: No season packs found
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"❌ No season packs found - falling back to regular search...", 
                    40, 
                    "warning",
                    current_step="No Season Packs",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                )
            else:
                # Step 8b: Season packs found
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_single",
                    f"🎯 Found suitable season packs - preparing for optimization...", 
                    40,
                    current_step="Season Packs Found",
                    details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count, "releases_found": len(releases)}
                )
                
                if settings and settings.skip_episode_deletion:
                    # Step 9a: Skip deletion with season packs
                    await manager.send_enhanced_progress_update(
                        self.user_id, 
                        show_title,
                        "season_it_single",
                        f"⚠️ Skipping episode deletion as per user settings...", 
                        45,
                        current_step="Skip Deletion",
                        details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                    )
                    logger.info(f"Skipping episode deletion for series {show_id} season {season_number} due to user settings")
                else:
                    # Step 9b: Delete episodes with season packs
                    await manager.send_enhanced_progress_update(
                        self.user_id, 
                        show_title,
                        "season_it_single",
                        f"🗑️ Preparing to delete {missing_count} individual episodes...", 
                        45,
                        current_step="Prepare Deletion",
                        details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                    )

                    # Step 10: Execute deletion
                    await manager.send_enhanced_progress_update(
                        self.user_id, 
                        show_title,
                        "season_it_single",
                        f"🧹 Deleting existing episodes from Season {season_number}...", 
                        50,
                        current_step="Execute Deletion",
                        details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                    )
                    
                    logger.info(f"Deleting existing episodes for series {show_id} season {season_number}")
                    await client.delete_season_episodes(show_id, season_number)

                    # Step 11: Confirm deletion
                    await manager.send_enhanced_progress_update(
                        self.user_id, 
                        show_title,
                        "season_it_single",
                        f"✅ Episode deletion completed successfully...", 
                        55,
                        current_step="Confirm Deletion",
                        details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
                    )

        # Step 12: Prepare search command
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🎬 Preparing season search command for Sonarr...", 
            60,
            current_step="Prepare Search",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        # Step 13: Validate search parameters
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🔧 Validating search parameters for Season {season_number}...", 
            65,
            current_step="Validate Parameters",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        # Step 14: Execute search command
        logger.info(f"Triggering season search for series {show_id} season {season_number}")
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🚀 Sending season search request to Sonarr...", 
            70,
            current_step="Send Search Request",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        # Step 15: Process search request
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"⏳ Sonarr is processing the season search request...", 
            80,
            current_step="Process Search",
            details={"poster_url": poster_url, "season_number": season_number, "missing_count": missing_count}
        )
        
        command_id = await client.search_season_pack(show_id, season_number)
        logger.info(f"Season search command {command_id} completed successfully")
        
        # Step 16: Verify command execution
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"✅ Search command executed successfully (ID: {command_id})...", 
            90,
            current_step="Verify Command",
            details={"poster_url": poster_url, "season_number": season_number, "command_id": command_id}
        )
        
        # Step 17: Finalize process
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_single",
            f"🎉 Season It completed! {show_title} Season {season_number} is now being processed by Sonarr.", 
            100, 
            "success",
            current_step="Complete",
            details={"poster_url": poster_url, "season_number": season_number, "command_id": command_id}
        )
        
        return {
            "status": "success",
            "season": season_number,
            "show": show_title,
            "missing_episodes": missing_count,
            "command_id": command_id,
            "message": f"Successfully triggered season search for Season {season_number}"
        }

    async def _process_all_seasons(self, client: SonarrClient, show_id: int, show_title: str, series_data: Dict) -> Dict[str, Any]:
        """Enhanced all seasons processing with detailed progress tracking"""
        
        # Step 1: Initialize all seasons process
        poster_url = client._get_poster_url(series_data.get("images", []), client.instance_id)
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"🔄 Initializing Season It for all seasons of '{show_title}'...", 
            5,
            current_step="Initialize",
            details={"poster_url": poster_url}
        )
        
        # Step 2: Scan all seasons for missing episodes
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"🔍 Scanning all seasons for missing episodes...", 
            10,
            current_step="Scan Episodes",
            details={"poster_url": poster_url}
        )
        
        missing_data = await client.get_missing_episodes(show_id)
        seasons_with_missing = missing_data.get("seasons_with_missing", {})
        
        if not seasons_with_missing:
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_all",
                f"✅ No missing episodes found for '{show_title}'", 
                100, 
                "warning",
                current_step="Complete",
                details={"poster_url": poster_url}
            )
            return {"status": "no_missing_episodes", "message": "No missing episodes found"}

        # Step 3: Check for future episodes
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"📅 Checking for seasons with unaired episodes...", 
            12,
            current_step="Check Future Episodes",
            details={"poster_url": poster_url}
        )
        
        future_check = await client.has_future_episodes(show_id)
        complete_seasons = set(future_check.get("seasons_complete", []))
        
        # Step 4: Analyze series structure
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"📊 Analyzing series structure and monitored seasons...", 
            15,
            current_step="Analyze Structure",
            details={"poster_url": poster_url}
        )
        
        seasons = series_data.get("seasons", [])
        monitored_seasons = [s for s in seasons if s.get("monitored", False) and s.get("seasonNumber", 0) > 0]
        # Filter out seasons with missing episodes AND seasons that have future episodes
        seasons_to_process = [s for s in monitored_seasons if s["seasonNumber"] in seasons_with_missing and s["seasonNumber"] in complete_seasons]
        
        if not seasons_to_process:
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_all",
                f"⚠️ No complete seasons with missing episodes found for '{show_title}' (incomplete seasons with future episodes are excluded)", 
                100, 
                "warning",
                current_step="Complete",
                details={"poster_url": poster_url}
            )
            return {"status": "no_seasons_to_process"}

        # Step 4: Calculate processing scope
        total_missing = sum(len(episodes) for episodes in seasons_with_missing.values())
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"📈 Processing scope: {total_missing} missing episodes across {len(seasons_to_process)} seasons", 
            20,
            current_step="Calculate Scope",
            details={"poster_url": poster_url, "total_missing": total_missing, "seasons_count": len(seasons_to_process)}
        )

        # Step 5: Initialize processing queue
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"🎯 Preparing to process {len(seasons_to_process)} seasons sequentially...", 
            25,
            current_step="Initialize Queue",
            details={"poster_url": poster_url, "seasons_count": len(seasons_to_process)}
        )

        results = []
        total_seasons = len(seasons_to_process)
        
        for i, season in enumerate(seasons_to_process):
            season_num = season["seasonNumber"]
            season_missing = len(seasons_with_missing.get(season_num, []))
            base_progress = 30 + (i * 60 // total_seasons)
            
            try:
                # Step 6+: Process individual seasons
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_all",
                    f"🎬 Starting Season {season_num} ({i+1}/{total_seasons}) - {season_missing} missing episodes", 
                    base_progress,
                    current_step=f"Process Season {season_num}",
                    details={"poster_url": poster_url, "season_number": season_num, "current_season": i+1, "total_seasons": total_seasons}
                )
                
                # Get poster URL for this show
                poster_url = client._get_banner_url(series_data.get("images", []), client.instance_id)
                result = await self._process_single_season(client, show_id, season_num, show_title, poster_url, series_data)
                results.append(result)
                
                # Progress update after each season
                completed_progress = 30 + ((i + 1) * 60 // total_seasons)
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_all",
                    f"✅ Season {season_num} completed ({i+1}/{total_seasons})", 
                    completed_progress,
                    current_step=f"Season {season_num} Complete",
                    details={"poster_url": poster_url, "season_number": season_num, "current_season": i+1, "total_seasons": total_seasons}
                )
                
                # Add delay between seasons to avoid overwhelming Sonarr
                if i < len(seasons_to_process) - 1:
                    await manager.send_enhanced_progress_update(
                        self.user_id, 
                        show_title,
                        "season_it_all",
                        f"⏳ Waiting 3 seconds before processing next season...", 
                        completed_progress + 1,
                        current_step="Wait",
                        details={"poster_url": poster_url}
                    )
                    await asyncio.sleep(3)
                
            except Exception as e:
                logger.error(f"Error processing season {season_num}: {e}")
                await manager.send_enhanced_progress_update(
                    self.user_id, 
                    show_title,
                    "season_it_all",
                    f"❌ Season {season_num} failed: {str(e)}", 
                    base_progress + 5,
                    "error",
                    current_step=f"Season {season_num} Failed",
                    details={"poster_url": poster_url, "season_number": season_num, "error": str(e)}
                )
                results.append({
                    "status": "error",
                    "season": season_num,
                    "error": str(e)
                })

        # Final analysis and reporting
        successful_seasons = [r for r in results if r.get("status") == "success"]
        failed_seasons = [r for r in results if r.get("status") == "error"]
        
        await manager.send_enhanced_progress_update(
            self.user_id, 
            show_title,
            "season_it_all",
            f"📊 Processing complete: {len(successful_seasons)} successful, {len(failed_seasons)} failed", 
            95,
            current_step="Processing Complete",
            details={"poster_url": poster_url, "successful_count": len(successful_seasons), "failed_count": len(failed_seasons)}
        )
        
        # Final completion message
        if failed_seasons:
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_all",
                f"⚠️ Season It completed with mixed results for '{show_title}': {len(successful_seasons)}/{len(results)} seasons successful", 
                100, 
                "warning",
                current_step="Complete",
                details={"poster_url": poster_url, "successful_count": len(successful_seasons), "failed_count": len(failed_seasons)}
            )
        else:
            await manager.send_enhanced_progress_update(
                self.user_id, 
                show_title,
                "season_it_all",
                f"🎉 Season It completed successfully for all {len(successful_seasons)} seasons of '{show_title}'!", 
                100, 
                "success",
                current_step="Complete",
                details={"poster_url": poster_url, "successful_count": len(successful_seasons)}
            )

        return {
            "status": "completed",
            "show": show_title,
            "total_missing_episodes": total_missing,
            "processed_seasons": len(results),
            "successful_seasons": len(successful_seasons),
            "results": results
        }

    def _get_sonarr_instance(self, show_id: int) -> Optional[SonarrInstance]:
        return self.db.query(SonarrInstance).filter(
            SonarrInstance.owner_id == self.user_id,
            SonarrInstance.is_active == True
        ).first()
    
    def _get_sonarr_instance_by_id(self, instance_id: int) -> Optional[SonarrInstance]:
        return self.db.query(SonarrInstance).filter(
            SonarrInstance.id == instance_id,
            SonarrInstance.owner_id == self.user_id,
            SonarrInstance.is_active == True
        ).first()

    async def _get_series_data(self, client: SonarrClient, show_id: int) -> Dict[str, Any]:
        import httpx
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{client.base_url}/api/v3/series/{show_id}",
                headers=client.headers
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch series data: {response.status_code}")
            
            return response.json()

    async def process_bulk_season_it(self, show_items: List[Dict]) -> Dict[str, Any]:
        """Process Season It for multiple shows using bulk operation manager"""
        operation_id = bulk_operation_manager.create_operation(
            user_id=self.user_id,
            operation_type="season_it_bulk",
            items=show_items,
            operation_func=self._process_bulk_item,
            description=f"Season It bulk operation for {len(show_items)} shows"
        )
        
        return await bulk_operation_manager.execute_operation(operation_id)
    
    async def _process_bulk_item(self, item: Dict, progress_callback: callable) -> Dict[str, Any]:
        """Process a single item in bulk operation"""
        show_id = item.get('id')
        show_title = item.get('name', f"Show {show_id}")
        season_number = item.get('season_number')  # None for all seasons
        
        try:
            # Get Sonarr instance
            instance_id = item.get('instance_id')
            instance = self._get_sonarr_instance_by_id(instance_id) if instance_id else self._get_sonarr_instance(show_id)
            if not instance:
                raise Exception("No Sonarr instance found for this show")
                
            client = SonarrClient(instance.url, instance.api_key, instance.id)
            
            # Get series data
            series_data = await self._get_series_data(client, show_id)
            show_title = series_data.get("title", show_title)
            poster_url = client._get_banner_url(series_data.get("images", []), client.instance_id)
            
            await progress_callback(10, f"Starting Season It for {show_title}", poster_url)
            
            await progress_callback(25, f"Processing {show_title}", poster_url)
            
            # Create activity log
            activity = self._create_activity_log(instance.id, show_id, show_title, season_number)
            
            if season_number:
                result = await self._process_single_season_with_callback(
                    client, show_id, season_number, show_title, progress_callback, poster_url
                )
            else:
                result = await self._process_all_seasons_with_callback(
                    client, show_id, show_title, series_data, progress_callback, poster_url
                )
            
            # Update activity log on success
            self._update_activity_log(
                activity,
                "success",
                f"Season It completed successfully for {show_title}" + (f" Season {season_number}" if season_number else " (All Seasons)")
            )
            
            await progress_callback(100, f"Completed Season It for {show_title}", poster_url)
            
            return {
                'status': 'success',
                'show_title': show_title,
                'result': result
            }
            
        except Exception as e:
            logger.error(f"Error processing bulk item {show_title}: {e}")
            if 'activity' in locals():
                self._update_activity_log(
                    activity,
                    "error",
                    f"Season It failed for {show_title}",
                    str(e)
                )
            raise Exception(f"Failed to process {show_title}: {str(e)}")
    
    async def _process_single_season_with_callback(self, client: SonarrClient, show_id: int, 
                                                  season_number: int, show_title: str, 
                                                  progress_callback: callable, poster_url: str = None) -> Dict[str, Any]:
        """Process single season with progress callback for bulk operations"""
        await progress_callback(25, f"Checking for future episodes in Season {season_number}", poster_url)
        
        # Check for future episodes first
        future_check = await client.has_future_episodes(show_id, season_number)
        if season_number in future_check.get("seasons_incomplete", []):
            await progress_callback(100, f"Season {season_number} has unaired episodes - skipping", poster_url)
            return {"status": "incomplete_season", "message": "Season has episodes that haven't aired yet"}
        
        await progress_callback(30, f"Checking missing episodes for Season {season_number}", poster_url)
        
        missing_data = await client.get_missing_episodes(show_id, season_number)
        seasons_with_missing = missing_data.get("seasons_with_missing", {})
        
        if season_number not in seasons_with_missing:
            await progress_callback(100, f"Season {season_number} has no missing episodes", poster_url)
            return {"status": "no_missing_episodes", "message": "No missing episodes found"}
        
        missing_count = len(seasons_with_missing[season_number])
        settings = self.db.query(UserSettings).filter(UserSettings.user_id == self.user_id).first()
        skip_season_pack_check = settings and settings.disable_season_pack_check
        
        if skip_season_pack_check:
            await progress_callback(50, f"Season pack check disabled, proceeding with regular search", poster_url)
            if not (settings and settings.skip_episode_deletion):
                await progress_callback(60, f"Deleting individual episodes", poster_url)
                await client.delete_season_episodes(show_id, season_number)
        else:
            await progress_callback(40, f"Checking for season packs", poster_url)
            releases = await client._get_releases(show_id, season_number)
            
            if not releases:
                await progress_callback(60, f"No season packs found, proceeding with regular search", poster_url)
            else:
                if not (settings and settings.skip_episode_deletion):
                    await progress_callback(70, f"Deleting individual episodes", poster_url)
                    await client.delete_season_episodes(show_id, season_number)
        
        await progress_callback(80, f"Triggering season search", poster_url)
        command_id = await client.search_season_pack(show_id, season_number)
        
        return {
            "status": "success",
            "season": season_number,
            "show": show_title,
            "missing_episodes": missing_count,
            "command_id": command_id
        }
    
    async def _process_all_seasons_with_callback(self, client: SonarrClient, show_id: int, 
                                               show_title: str, series_data: Dict, 
                                               progress_callback: callable, poster_url: str = None) -> Dict[str, Any]:
        """Process all seasons with progress callback for bulk operations"""
        await progress_callback(25, f"Checking for future episodes", poster_url)
        
        # Check for future episodes first
        future_check = await client.has_future_episodes(show_id)
        complete_seasons = set(future_check.get("seasons_complete", []))
        
        await progress_callback(30, f"Checking missing episodes in all seasons", poster_url)
        
        missing_data = await client.get_missing_episodes(show_id)
        seasons_with_missing = missing_data.get("seasons_with_missing", {})
        
        if not seasons_with_missing:
            await progress_callback(100, f"No missing episodes found", poster_url)
            return {"status": "no_missing_episodes", "message": "No missing episodes found"}
        
        seasons = series_data.get("seasons", [])
        monitored_seasons = [s for s in seasons if s.get("monitored", False) and s.get("seasonNumber", 0) > 0]
        # Filter out seasons with missing episodes AND seasons that have future episodes
        seasons_to_process = [s for s in monitored_seasons if s["seasonNumber"] in seasons_with_missing and s["seasonNumber"] in complete_seasons]
        
        if not seasons_to_process:
            await progress_callback(100, f"No complete seasons with missing episodes to process", poster_url)
            return {"status": "no_seasons_to_process"}
        
        results = []
        total_seasons = len(seasons_to_process)
        
        for i, season in enumerate(seasons_to_process):
            season_num = season["seasonNumber"]
            base_progress = 40 + (i * 50 // total_seasons)
            
            await progress_callback(base_progress, f"Processing Season {season_num} ({i+1}/{total_seasons})", poster_url)
            
            try:
                result = await self._process_single_season_with_callback(
                    client, show_id, season_num, show_title, 
                    lambda p, m, poster=None: progress_callback(base_progress + (p * 50 // (total_seasons * 100)), m, poster_url),
                    poster_url
                )
                results.append(result)
                
                if i < len(seasons_to_process) - 1:
                    await asyncio.sleep(3)
                    
            except Exception as e:
                logger.error(f"Error processing season {season_num}: {e}")
                results.append({
                    "status": "error",
                    "season": season_num,
                    "error": str(e)
                })
        
        successful_seasons = [r for r in results if r.get("status") == "success"]
        
        return {
            "status": "completed",
            "show": show_title,
            "processed_seasons": len(results),
            "successful_seasons": len(successful_seasons),
            "results": results
        }

